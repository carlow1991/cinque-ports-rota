-- Rollback for 20261018000400_reschedule_preview.sql: restores the previous reschedule_event()
-- and removes the preview. Changes no data.

create or replace function public.reschedule_event(p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_delta interval;
  s record;
  v_ns timestamptz; v_ne timestamptz;
  v_shift_ids uuid[];
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

  update public.events set starts_at = p_starts_at, ends_at = p_ends_at,
         kickoff_at = case when kickoff_at is null then null else kickoff_at + v_delta end
   where id = p_event_id;

  for s in select sh.*, ti.start_anchor, ti.start_offset_minutes, ti.end_anchor, ti.end_offset_minutes
           from public.event_shifts sh left join public.duty_template_items ti on ti.id = sh.source_template_item_id
           where sh.event_id = p_event_id and sh.status = 'active' order by sh.id for update of sh
  loop
    if s.start_anchor is not null then
      v_ns := (case s.start_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => s.start_offset_minutes);
      v_ne := (case s.end_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => s.end_offset_minutes);
    else
      v_ns := s.starts_at + v_delta;
      v_ne := s.ends_at + v_delta;
    end if;
    update public.event_shifts set starts_at = v_ns, ends_at = v_ne where id = s.id;
    v_shift_ids := array_append(v_shift_ids, s.id);
  end loop;

  if v_shift_ids is not null then
    n := public._reset_assignments_for_reconfirm(v_shift_ids, 'reconfirm_needed');
  end if;
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  return jsonb_build_object('event_id', p_event_id, 'assignments_reset', n);
end;
$$;

drop function if exists public.preview_reschedule(uuid, timestamptz, timestamptz);
drop function if exists public._rescheduled_shift_times(uuid, timestamptz, timestamptz);
