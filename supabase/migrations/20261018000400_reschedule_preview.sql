-- Improvement increment 5 (event management): an honest preview before moving an event.
--
-- The new duty times are now worked out in ONE internal function, used both by the real
-- reschedule_event() and by the read-only preview_reschedule(), so the preview always shows exactly
-- what saving will do. Behaviour of reschedule_event() is unchanged:
--   * a duty generated from a template is re-timed from that template item's CURRENT anchors and
--     offsets (event start/end ± minutes);
--   * any other duty (hand-made, or its template item deleted) moves by the same amount as the start;
--   * everyone on an affected duty is asked to reconfirm; venue cover alerts dependent events.
--
-- Rollback: docs/sql/rollback-20261018000400.sql restores the previous reschedule_event() and drops
-- the two new functions. No data is touched.

create function public._rescheduled_shift_times(p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns table (shift_id uuid, new_starts_at timestamptz, new_ends_at timestamptz, from_template boolean)
language sql stable security definer set search_path = '' as $$
  select sh.id,
         case when ti.id is null then sh.starts_at + (p_starts_at - e.starts_at)
              else (case ti.start_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => ti.start_offset_minutes) end,
         case when ti.id is null then sh.ends_at + (p_starts_at - e.starts_at)
              else (case ti.end_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => ti.end_offset_minutes) end,
         ti.id is not null
  from public.event_shifts sh
  join public.events e on e.id = sh.event_id
  left join public.duty_template_items ti on ti.id = sh.source_template_item_id
  where sh.event_id = p_event_id and sh.status = 'active'
$$;

create or replace function public.reschedule_event(p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_delta interval;
  v_shift_ids uuid[];
  v_ns timestamptz[];
  v_ne timestamptz[];
  n int := 0;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    perform public._fail('invalid_times', 'The event must end after it starts.');
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status not in ('draft', 'published', 'postponed') then perform public._fail('invalid_transition', 'This event is closed.'); end if;
  if v_e.starts_at = p_starts_at and v_e.ends_at = p_ends_at then
    return jsonb_build_object('event_id', p_event_id, 'assignments_reset', 0);
  end if;
  v_delta := p_starts_at - v_e.starts_at;

  -- Lock the duties, then compute their new times from the event's OLD start (before it moves).
  perform 1 from public.event_shifts where event_id = p_event_id and status = 'active' order by id for update;
  select array_agg(r.shift_id order by r.shift_id), array_agg(r.new_starts_at order by r.shift_id), array_agg(r.new_ends_at order by r.shift_id)
    into v_shift_ids, v_ns, v_ne
    from public._rescheduled_shift_times(p_event_id, p_starts_at, p_ends_at) r;

  update public.events set starts_at = p_starts_at, ends_at = p_ends_at,
         kickoff_at = case when kickoff_at is null then null else kickoff_at + v_delta end
   where id = p_event_id;

  if v_shift_ids is not null then
    update public.event_shifts sh set starts_at = x.ns, ends_at = x.ne
      from unnest(v_shift_ids, v_ns, v_ne) as x(id, ns, ne) where sh.id = x.id;
    n := public._reset_assignments_for_reconfirm(v_shift_ids, 'reconfirm_needed');
  end if;
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  return jsonb_build_object('event_id', p_event_id, 'assignments_reset', n);
end;
$$;

-- Read-only: what moving the event would do to each duty and how many people would need to reconfirm.
create function public.preview_reschedule(p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns table (shift_id uuid, duty_name text, old_starts_at timestamptz, old_ends_at timestamptz,
               new_starts_at timestamptz, new_ends_at timestamptz, from_template boolean, people_to_reconfirm int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_event(p_event_id) or p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then return; end if;
  return query
  select sh.id, dt.name, sh.starts_at, sh.ends_at, r.new_starts_at, r.new_ends_at, r.from_template,
         (select count(*)::int from public.assignments a where a.shift_id = sh.id and a.status in ('invited', 'pending_approval', 'confirmed'))
  from public._rescheduled_shift_times(p_event_id, p_starts_at, p_ends_at) r
  join public.event_shifts sh on sh.id = r.shift_id
  join public.duty_types dt on dt.id = sh.duty_type_id
  order by r.new_starts_at, dt.sort_order, sh.id;
end;
$$;

revoke execute on function public._rescheduled_shift_times(uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function public.preview_reschedule(uuid, timestamptz, timestamptz) from public, anon, service_role;
grant execute on function public.preview_reschedule(uuid, timestamptz, timestamptz) to authenticated;
