-- Phase 5: organiser tools. Venue-scoped reads for rosters, the "needs action" queue and site-lead
-- names, plus admin functions for adding volunteers and coordinator venue scopes.
-- Contact data: organisers see a volunteer's PHONE only for volunteers on their venue's duties
-- (decision Q10). Email is never returned by these functions (data minimisation).

-- Roster for managed events overlapping a window (or one event). One row per active assignment;
-- duties with nobody yet appear once with null volunteer fields, so a printed rota shows empty places.
create function public.manage_roster(
  p_from timestamptz, p_to timestamptz, p_venue_id uuid default null, p_event_id uuid default null
) returns table (
  event_id uuid, event_title text, event_type public.event_type, event_status public.event_status, is_demo boolean,
  venue_id uuid, venue_name text, team_name text, event_starts_at timestamptz, event_ends_at timestamptz,
  shift_id uuid, duty_code text, duty_name text, responsibilities text[], shift_starts_at timestamptz, shift_ends_at timestamptz,
  required_count int, approval_required boolean, signup_enabled boolean, shift_instructions text,
  assignment_id uuid, volunteer_id uuid, display_name text, phone text, status public.assignment_status,
  source public.assignment_source, attendance_status public.attendance_status, status_changed_at timestamptz,
  cancellation_request_id uuid, cancellation_reason text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_manager() then return; end if;
  return query
  select e.id, e.title, e.event_type, e.status, e.is_demo, e.venue_id, v.name, t.name, e.starts_at, e.ends_at,
         s.id, dt.code, dt.name,
         coalesce((select array_agg(rd.name order by rd.sort_order) from public.event_shift_responsibilities r
                   join public.duty_types rd on rd.id = r.duty_type_id where r.shift_id = s.id), '{}'),
         s.starts_at, s.ends_at, s.required_count, s.approval_required, s.signup_enabled, s.instructions,
         a.id, vol.id, vol.display_name, vol.phone, a.status, a.source, a.attendance_status, a.status_changed_at,
         cr.id, cr.reason
  from public.events e
  join public.venues v on v.id = e.venue_id
  left join public.teams t on t.id = e.team_id
  join public.event_shifts s on s.event_id = e.id and s.status = 'active'
  join public.duty_types dt on dt.id = s.duty_type_id
  left join public.assignments a on a.shift_id = s.id and a.status in ('invited', 'pending_approval', 'confirmed')
  left join public.volunteers vol on vol.id = a.volunteer_id
  left join public.cancellation_requests cr on cr.assignment_id = a.id and cr.status = 'pending'
  where public.can_manage_venue(e.venue_id)
    and (p_event_id is null or e.id = p_event_id)
    and (p_event_id is not null or (e.starts_at < p_to and e.ends_at > p_from))
    and (p_venue_id is null or e.venue_id = p_venue_id)
    and e.status <> 'cancelled'
  order by e.starts_at, e.id, s.starts_at, dt.sort_order, s.id,
           case a.status when 'confirmed' then 0 when 'pending_approval' then 1 else 2 end, vol.display_name;
end;
$$;

-- Everything waiting on an organiser at the caller's venues: approvals, late-cancellation requests
-- and unanswered invitations (for duties that haven't started).
create function public.manage_action_queue()
returns table (
  kind text, assignment_id uuid, request_id uuid, event_id uuid, event_title text, venue_name text,
  duty_name text, shift_starts_at timestamptz, shift_ends_at timestamptz, display_name text, reason text, since timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_manager() then return; end if;
  return query
  select x.* from (
    select case a.status when 'pending_approval' then 'approval' else 'invitation' end::text,
           a.id, null::uuid, e.id, e.title, v.name, dt.name, s.starts_at, s.ends_at, vol.display_name, null::text, a.status_changed_at
    from public.assignments a
    join public.event_shifts s on s.id = a.shift_id and s.status = 'active'
    join public.events e on e.id = s.event_id and e.status in ('published', 'postponed')
    join public.venues v on v.id = e.venue_id
    join public.duty_types dt on dt.id = s.duty_type_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where a.status in ('pending_approval', 'invited') and s.starts_at > now() and public.can_manage_venue(e.venue_id)
    union all
    select 'cancellation', a.id, cr.id, e.id, e.title, v.name, dt.name, s.starts_at, s.ends_at, vol.display_name, cr.reason, cr.created_at
    from public.cancellation_requests cr
    join public.assignments a on a.id = cr.assignment_id
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    join public.venues v on v.id = e.venue_id
    join public.duty_types dt on dt.id = s.duty_type_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where cr.status = 'pending' and public.can_manage_venue(e.venue_id)
  ) x(k, aid, rid, eid, etitle, vname, dname, ss, se, vol_name, rsn, since_at)
  order by case x.k when 'cancellation' then 0 when 'approval' then 1 else 2 end, x.ss;
end;
$$;

-- Who is providing site-lead cover for an event: its own site-lead duties and those on its linked
-- venue-cover event, with each person's status and whether they are currently authorised.
-- Provider cover is reported by event_site_coverage() and deliberately has NO name here.
create function public.event_cover_leads(p_event_id uuid)
returns table (source text, event_id uuid, event_title text, shift_id uuid, starts_at timestamptz, ends_at timestamptz,
               display_name text, status public.assignment_status, authorised boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_cover uuid;
begin
  if not public.can_manage_event(p_event_id) then return; end if;
  select coverage_event_id into v_cover from public.events where id = p_event_id;
  return query
  select case when s.event_id = p_event_id then 'this_event' else 'linked_cover' end,
         e.id, e.title, s.id, s.starts_at, s.ends_at, vol.display_name, a.status,
         case when a.id is null then null else public.volunteer_is_eligible(a.volunteer_id, s.id, s.ends_at) end
  from public.event_shifts s
  join public.events e on e.id = s.event_id
  join public.duty_types dt on dt.id = s.duty_type_id and dt.code = 'site_lead'
  left join public.assignments a on a.shift_id = s.id and a.status in ('invited', 'pending_approval', 'confirmed')
  left join public.volunteers vol on vol.id = a.volunteer_id
  where s.status = 'active' and (s.event_id = p_event_id or (v_cover is not null and s.event_id = v_cover and e.status <> 'cancelled'))
  order by s.starts_at, case a.status when 'confirmed' then 0 when 'pending_approval' then 1 else 2 end;
end;
$$;

-- Admin: add (or re-invite) a volunteer row ready for an Auth invitation. Returns whether an
-- Auth account is already linked (then no invite email is needed).
create function public.admin_create_volunteer(p_email text, p_display_name text, p_role public.app_role default 'volunteer')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_row public.volunteers%rowtype;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can add volunteers.'); end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then perform public._fail('invalid_email', 'Enter a valid email address.'); end if;
  if v_name = '' or length(v_name) > 80 then perform public._fail('invalid_name', 'Enter a name (up to 80 characters).'); end if;
  select * into v_row from public.volunteers where email operator(extensions.=) v_email::extensions.citext for update;
  if found then
    if v_row.role = 'admin' and p_role <> 'admin' and v_row.is_active
       and (select count(*) from public.volunteers where role = 'admin' and is_active and id <> v_row.id) = 0 then
      perform public._fail('last_admin', 'The club must keep at least one active administrator.');
    end if;
    update public.volunteers set display_name = v_name, role = p_role, is_active = true, invited_at = now()
     where id = v_row.id;
    return jsonb_build_object('volunteer_id', v_row.id, 'already_linked', v_row.auth_user_id is not null, 'existing', true);
  end if;
  insert into public.volunteers (email, display_name, role, is_active, invited_at)
  values (v_email, v_name, p_role, true, now()) returning * into v_row;
  return jsonb_build_object('volunteer_id', v_row.id, 'already_linked', false, 'existing', false);
end;
$$;

-- Admin: replace a coordinator's venue scope atomically.
create function public.admin_set_coordinator_venues(p_volunteer_id uuid, p_venue_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_role public.app_role;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can change venue access.'); end if;
  select role into v_role from public.volunteers where id = p_volunteer_id for update;
  if v_role is null then perform public._fail('not_found', 'Volunteer not found.'); end if;
  if v_role <> 'coordinator' and cardinality(coalesce(p_venue_ids, '{}')) > 0 then
    perform public._fail('not_coordinator', 'Make this person a coordinator before giving them venues.');
  end if;
  delete from public.coordinator_venues where volunteer_id = p_volunteer_id and not (venue_id = any (coalesce(p_venue_ids, '{}')));
  insert into public.coordinator_venues (volunteer_id, venue_id)
  select p_volunteer_id, x from unnest(coalesce(p_venue_ids, '{}')) x
  where exists (select 1 from public.venues where id = x)
  on conflict do nothing;
  return jsonb_build_object('volunteer_id', p_volunteer_id, 'venues', (select count(*) from public.coordinator_venues where volunteer_id = p_volunteer_id));
end;
$$;

-- Default execute privileges are revoked (20261017000200), so grant explicitly.
grant execute on function
  public.manage_roster(timestamptz, timestamptz, uuid, uuid),
  public.manage_action_queue(),
  public.event_cover_leads(uuid),
  public.admin_create_volunteer(text, text, public.app_role),
  public.admin_set_coordinator_venues(uuid, uuid[])
to authenticated;
