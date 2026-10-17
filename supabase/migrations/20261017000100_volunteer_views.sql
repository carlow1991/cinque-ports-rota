-- Phase 4: sanitised read functions for the volunteer portal.
-- Each returns ONLY what the caller may see: published events, counts (never other people's
-- identities or contact details), and the caller's own status/eligibility. Inactive or anonymous
-- callers get nothing.

-- Upcoming published events with vacancy counts.
--   open_slots          = places on sign-up duties not yet confirmed/pending (all volunteers)
--   eligible_open_slots = of those, places on duties the CALLER could take now (authorised,
--                         not already on it, not started, no clash with their other commitments)
create function public.volunteer_rota(p_from timestamptz, p_to timestamptz, p_venue_id uuid default null)
returns table (
  event_id uuid, title text, event_type public.event_type, venue_id uuid, venue_name text, team_id uuid, team_name text,
  starts_at timestamptz, ends_at timestamptz, kickoff_at timestamptz, opponent text, is_demo boolean,
  open_slots int, eligible_open_slots int, my_active_count int
)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_volunteer_id();
begin
  if v_me is null then return; end if;
  return query
  select e.id, e.title, e.event_type, e.venue_id, v.name, e.team_id, t.name, e.starts_at, e.ends_at, e.kickoff_at, e.opponent, e.is_demo,
         coalesce(x.open, 0), coalesce(x.eligible, 0), coalesce(x.mine, 0)
  from public.events e
  join public.venues v on v.id = e.venue_id
  left join public.teams t on t.id = e.team_id
  left join lateral (
    select
      sum(case when s.signup_enabled then greatest(0, s.required_count - c.confirmed - c.pending) else 0 end)::int as open,
      sum(case when s.signup_enabled and s.starts_at > now()
                    and not exists (select 1 from public.assignments a where a.shift_id = s.id and a.volunteer_id = v_me
                                    and a.status in ('invited', 'pending_approval', 'confirmed', 'cancelled'))
                    and cardinality(public.missing_authorisations(v_me, s.id, s.ends_at)) = 0
                    and not public._has_overlap(v_me, s.id)
               then greatest(0, s.required_count - c.confirmed - c.pending) else 0 end)::int as eligible,
      (select count(*)::int from public.assignments a join public.event_shifts s2 on s2.id = a.shift_id
        where s2.event_id = e.id and s2.status = 'active' and a.volunteer_id = v_me
          and a.status in ('invited', 'pending_approval', 'confirmed')) as mine
    from public.event_shifts s cross join lateral public._shift_counts(s.id) c
    where s.event_id = e.id and s.status = 'active') x on true
  where e.status = 'published'
    and e.ends_at > greatest(p_from, now())
    and e.starts_at < p_to
    and (p_venue_id is null or e.venue_id = p_venue_id)
  order by e.starts_at, v.name, e.title;
end;
$$;

-- One event's duties as the caller sees them.
create function public.volunteer_event_view(p_event_id uuid)
returns table (
  shift_id uuid, duty_code text, duty_name text, duty_description text, starts_at timestamptz, ends_at timestamptz,
  required_count int, confirmed_count int, pending_count int, open_slots int,
  signup_enabled boolean, approval_required boolean, instructions text, responsibilities text[],
  my_assignment_id uuid, my_status public.assignment_status, my_cancellation_pending boolean,
  missing_authorisations text[], has_overlap boolean, has_started boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_volunteer_id();
begin
  if v_me is null or not public.can_view_event(p_event_id) then return; end if;
  return query
  select s.id, dt.code, dt.name, dt.description, s.starts_at, s.ends_at,
         s.required_count, c.confirmed, c.pending, greatest(0, s.required_count - c.confirmed - c.pending),
         s.signup_enabled, s.approval_required, s.instructions,
         coalesce((select array_agg(rd.name order by rd.sort_order) from public.event_shift_responsibilities r
                   join public.duty_types rd on rd.id = r.duty_type_id where r.shift_id = s.id), '{}'),
         a.id, a.status,
         exists (select 1 from public.cancellation_requests cr where cr.assignment_id = a.id and cr.status = 'pending'),
         -- show the duty NAMES the caller still needs, not codes
         coalesce((select array_agg(d2.name order by d2.sort_order) from public.duty_types d2
                   where d2.code = any (public.missing_authorisations(v_me, s.id, s.ends_at))), '{}'),
         case when a.status in ('pending_approval', 'confirmed') then false else public._has_overlap(v_me, s.id) end,
         s.starts_at <= now()
  from public.event_shifts s
  join public.duty_types dt on dt.id = s.duty_type_id
  cross join lateral public._shift_counts(s.id) c
  left join public.assignments a on a.shift_id = s.id and a.volunteer_id = v_me
  where s.event_id = p_event_id and s.status = 'active'
  order by s.starts_at, dt.sort_order, s.id;
end;
$$;

-- The caller's own duties (all statuses), with everything My Duties needs and nothing about anyone else.
create function public.my_duties()
returns table (
  assignment_id uuid, status public.assignment_status, source public.assignment_source,
  attendance_status public.attendance_status, status_changed_at timestamptz, removal_reason text,
  event_id uuid, event_title text, event_status public.event_status, event_status_reason text, event_instructions text,
  venue_name text, venue_address text, duty_name text, responsibilities text[],
  starts_at timestamptz, ends_at timestamptz, shift_status public.shift_status, shift_instructions text,
  approval_required boolean, cancellation_pending boolean, withdraw_deadline timestamptz, is_demo boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_volunteer_id();
  v_cutoff int := coalesce((select withdrawal_cutoff_hours from public.club_settings where id = 1), 24);
begin
  if v_me is null then return; end if;
  return query
  select a.id, a.status, a.source, a.attendance_status, a.status_changed_at, a.removal_reason,
         e.id, e.title, e.status, e.status_reason, e.instructions,
         v.name, v.address, dt.name,
         coalesce((select array_agg(rd.name order by rd.sort_order) from public.event_shift_responsibilities r
                   join public.duty_types rd on rd.id = r.duty_type_id where r.shift_id = s.id), '{}'),
         s.starts_at, s.ends_at, s.status, s.instructions, s.approval_required,
         exists (select 1 from public.cancellation_requests cr where cr.assignment_id = a.id and cr.status = 'pending'),
         s.starts_at - make_interval(hours => v_cutoff), e.is_demo
  from public.assignments a
  join public.event_shifts s on s.id = a.shift_id
  join public.events e on e.id = s.event_id
  join public.venues v on v.id = e.venue_id
  join public.duty_types dt on dt.id = s.duty_type_id
  where a.volunteer_id = v_me
  order by s.starts_at, a.id;
end;
$$;

grant execute on function
  public.volunteer_rota(timestamptz, timestamptz, uuid),
  public.volunteer_event_view(uuid),
  public.my_duties()
to authenticated;
