-- Phase 3: event building. Template-driven shift generation, atomic event creation, adding
-- duties, linking venue-wide cover, and an organiser overview for the calendar.

-- Links now change only through link_venue_cover(), which also tidies suppressed duties.
revoke update (coverage_event_id) on public.events from authenticated;
-- Demo flags suppress email; only the local dev seed may set them, never the app.
revoke insert (is_demo) on public.events from authenticated;

-- ---------------------------------------------------------------------------
-- Core expansion (internal). Mirrors src/lib/domain/templates.ts exactly:
--   start = anchor(start_anchor) + start_offset minutes; end likewise (absolute minutes, DST-safe)
--   * only ENABLED items are generated (p_enabled null → each item's enabled_by_default)
--   * items marked suppressed_by_linked_cover are skipped when the event is linked to venue cover
--   * idempotent: an item already generated for this event (active shift) is never duplicated
--   * included responsibilities copied onto the shift; they add no headcount
-- ---------------------------------------------------------------------------
create function public._apply_template(p_event_id uuid, p_template_id uuid, p_enabled uuid[], p_counts jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_e public.events%rowtype;
  v_t public.duty_templates%rowtype;
  i record;
  v_count int;
  v_shift uuid;
  v_start timestamptz; v_end timestamptz;
  n int := 0;
begin
  select * into v_e from public.events where id = p_event_id;
  select * into v_t from public.duty_templates where id = p_template_id;
  if v_t.id is null or not v_t.active then perform public._fail('not_found', 'Template not found.'); end if;
  if v_t.venue_id is not null and v_t.venue_id <> v_e.venue_id then
    perform public._fail('template_wrong_venue', 'This template is for a different venue.');
  end if;
  if p_enabled is not null and exists (
       select 1 from unnest(p_enabled) x where x not in (select id from public.duty_template_items where template_id = p_template_id)) then
    perform public._fail('invalid_item', 'An enabled duty does not belong to this template.');
  end if;

  for i in select * from public.duty_template_items where template_id = p_template_id order by sort_order loop
    continue when not (case when p_enabled is null then i.enabled_by_default else i.id = any (p_enabled) end);
    continue when i.suppressed_by_linked_cover and v_e.coverage_event_id is not null;
    continue when exists (select 1 from public.event_shifts
                          where event_id = p_event_id and source_template_item_id = i.id and status = 'active');

    v_count := coalesce((p_counts ->> i.id::text)::int, i.required_count);
    if v_count < 1 or v_count > 50 then
      perform public._fail('invalid_headcount', 'Each duty needs between 1 and 50 volunteers.');
    end if;
    v_start := (case i.start_anchor when 'event_start' then v_e.starts_at else v_e.ends_at end) + make_interval(mins => i.start_offset_minutes);
    v_end   := (case i.end_anchor   when 'event_start' then v_e.starts_at else v_e.ends_at end) + make_interval(mins => i.end_offset_minutes);
    if v_start >= v_end then
      perform public._fail('invalid_times', format('A generated duty would end before it starts (%s). Check the event times.',
        (select name from public.duty_types where id = i.duty_type_id)));
    end if;

    insert into public.event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, signup_enabled,
                                     approval_required, instructions, source_template_item_id)
    values (p_event_id, i.duty_type_id, v_start, v_end, v_count, i.signup_enabled, i.approval_required, i.instructions, i.id)
    returning id into v_shift;
    insert into public.event_shift_responsibilities (shift_id, duty_type_id)
    select v_shift, r.duty_type_id from public.template_item_responsibilities r where r.template_item_id = i.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function public.apply_template(p_event_id uuid, p_template_id uuid, p_enabled uuid[] default null, p_counts jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_e public.events%rowtype; n int;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status not in ('draft', 'published', 'postponed') then perform public._fail('invalid_transition', 'This event is closed.'); end if;
  n := public._apply_template(p_event_id, p_template_id, p_enabled, coalesce(p_counts, '{}'));
  return jsonb_build_object('event_id', p_event_id, 'shifts_created', n);
end;
$$;

-- Atomic: the draft event and all its generated duties are created together, or not at all.
create function public.create_event(
  p_venue_id uuid, p_title text, p_event_type public.event_type, p_starts_at timestamptz, p_ends_at timestamptz,
  p_team_id uuid default null, p_kickoff_at timestamptz default null, p_opponent text default null,
  p_competition text default null, p_description text default null, p_instructions text default null,
  p_coverage_event_id uuid default null, p_site_responsibility boolean default true,
  p_template_id uuid default null, p_enabled uuid[] default null, p_counts jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_id uuid; n int := 0;
begin
  if not public.can_manage_venue(p_venue_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  if p_title is null or btrim(p_title) = '' then perform public._fail('title_required', 'Give the event a title.'); end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    perform public._fail('invalid_times', 'The event must end after it starts.');
  end if;
  insert into public.events (venue_id, team_id, coverage_event_id, title, event_type, starts_at, ends_at, kickoff_at,
                             opponent, competition, description, instructions, site_responsibility, created_by)
  values (p_venue_id, p_team_id, p_coverage_event_id, btrim(p_title), p_event_type, p_starts_at, p_ends_at, p_kickoff_at,
          nullif(btrim(p_opponent), ''), nullif(btrim(p_competition), ''), nullif(btrim(p_description), ''),
          nullif(btrim(p_instructions), ''), coalesce(p_site_responsibility, true), v_me)
  returning id into v_id;
  if p_template_id is not null then
    n := public._apply_template(v_id, p_template_id, p_enabled, coalesce(p_counts, '{}'));
  end if;
  return jsonb_build_object('event_id', v_id, 'shifts_created', n);
end;
$$;

-- Add one hand-made duty (primary + included responsibilities) atomically.
create function public.add_shift(
  p_event_id uuid, p_duty_code text, p_starts_at timestamptz, p_ends_at timestamptz, p_required_count int,
  p_signup_enabled boolean default true, p_approval_required boolean default false,
  p_instructions text default null, p_responsibilities text[] default '{}'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_e public.events%rowtype; v_duty uuid; v_id uuid;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status not in ('draft', 'published', 'postponed') then perform public._fail('invalid_transition', 'This event is closed.'); end if;
  select id into v_duty from public.duty_types where code = p_duty_code and active;
  if v_duty is null then perform public._fail('not_found', 'Unknown duty.'); end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    perform public._fail('invalid_times', 'The duty must end after it starts.');
  end if;
  if p_required_count is null or p_required_count < 1 or p_required_count > 50 then
    perform public._fail('invalid_headcount', 'Each duty needs between 1 and 50 volunteers.');
  end if;
  if p_duty_code = any (coalesce(p_responsibilities, '{}')) then
    perform public._fail('responsibility_is_primary', 'An included responsibility cannot repeat the main duty.');
  end if;
  insert into public.event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, signup_enabled, approval_required, instructions)
  values (p_event_id, v_duty, p_starts_at, p_ends_at, p_required_count, coalesce(p_signup_enabled, true),
          coalesce(p_approval_required, false), nullif(btrim(p_instructions), ''))
  returning id into v_id;
  insert into public.event_shift_responsibilities (shift_id, duty_type_id)
  select v_id, dt.id from public.duty_types dt where dt.code = any (coalesce(p_responsibilities, '{}'));
  if (select count(*) from public.event_shift_responsibilities where shift_id = v_id) <> cardinality(coalesce(p_responsibilities, '{}')) then
    perform public._fail('not_found', 'Unknown included responsibility.');
  end if;
  return jsonb_build_object('shift_id', v_id);
end;
$$;

-- Link (or unlink) an event to same-venue venue-wide cover. When linking, template-generated
-- site-lead-type duties that the link now replaces are cancelled ONLY if nobody is committed to
-- them, so the event never shows a duplicate site-lead vacancy. Committed ones are kept and reported.
create function public.link_venue_cover(p_event_id uuid, p_coverage_event_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  s record;
  v_cancelled int := 0;
  v_kept int := 0;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status in ('cancelled', 'completed') then perform public._fail('invalid_transition', 'This event is closed.'); end if;
  update public.events set coverage_event_id = p_coverage_event_id where id = p_event_id;  -- trigger validates

  if p_coverage_event_id is not null then
    for s in select sh.id from public.event_shifts sh
             join public.duty_template_items ti on ti.id = sh.source_template_item_id
             where sh.event_id = p_event_id and sh.status = 'active' and ti.suppressed_by_linked_cover
             for update of sh
    loop
      if exists (select 1 from public.assignments a where a.shift_id = s.id and a.status in ('invited', 'pending_approval', 'confirmed')) then
        v_kept := v_kept + 1;
      else
        update public.event_shifts set status = 'cancelled' where id = s.id;
        v_cancelled := v_cancelled + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('event_id', p_event_id, 'coverage_event_id', p_coverage_event_id,
                            'duplicate_duties_removed', v_cancelled, 'duplicate_duties_kept', v_kept);
end;
$$;

-- Organiser overview for the calendar/dashboard: one row per event the caller manages that
-- overlaps [p_from, p_to). Counts are headcount (composite responsibilities never add slots).
create function public.manage_events_overview(p_from timestamptz, p_to timestamptz, p_venue_id uuid default null)
returns table (
  event_id uuid, title text, event_type public.event_type, status public.event_status, is_demo boolean,
  venue_id uuid, venue_name text, team_name text, starts_at timestamptz, ends_at timestamptz, kickoff_at timestamptz,
  coverage_event_id uuid, shift_rows int, required_slots int, confirmed int, pending int, invited int, open_slots int,
  cover_state text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_manager() then return; end if;
  return query
  select e.id, e.title, e.event_type, e.status, e.is_demo, e.venue_id, v.name, t.name, e.starts_at, e.ends_at, e.kickoff_at,
         e.coverage_event_id,
         coalesce(x.rows, 0), coalesce(x.req, 0), coalesce(x.conf, 0), coalesce(x.pend, 0), coalesce(x.inv, 0),
         coalesce(x.open, 0),
         case when e.status in ('cancelled', 'completed') then null
              else (select c.state from public.event_site_coverage(e.id) c) end
  from public.events e
  join public.venues v on v.id = e.venue_id
  left join public.teams t on t.id = e.team_id
  left join lateral (
    select count(*)::int as rows, sum(s.required_count)::int as req,
           sum(c.confirmed)::int as conf, sum(c.pending)::int as pend, sum(c.invited)::int as inv,
           sum(greatest(0, s.required_count - c.confirmed - c.pending))::int as open
    from public.event_shifts s cross join lateral public._shift_counts(s.id) c
    where s.event_id = e.id and s.status = 'active') x on true
  where e.starts_at < p_to and e.ends_at > p_from
    and public.can_manage_venue(e.venue_id)
    and (p_venue_id is null or e.venue_id = p_venue_id)
  order by e.starts_at, v.name, e.title;
end;
$$;

revoke execute on function public._apply_template(uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function
  public.apply_template(uuid, uuid, uuid[], jsonb),
  public.create_event(uuid, text, public.event_type, timestamptz, timestamptz, uuid, timestamptz, text, text, text, text,
                      uuid, boolean, uuid, uuid[], jsonb),
  public.add_shift(uuid, text, timestamptz, timestamptz, int, boolean, boolean, text, text[]),
  public.link_venue_cover(uuid, uuid),
  public.manage_events_overview(timestamptz, timestamptz, uuid)
to authenticated;
