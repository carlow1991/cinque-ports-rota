-- Volunteer Hub · Stage 4: shared venue cover and the weekend overview.
-- A venue-wide assignment (hub_assignments.scope = 'venue') is stored ONCE and shown as derived,
-- read-only context on every event it overlaps. Nothing is copied per event, so changing or
-- cancelling it updates every view at once. Overlap rules:
--   * event finish known   → covers "full" (whole window) or "partial"
--   * event finish unknown → only "at_start_only" (covers kick-off), never claimed for the whole event
-- Conflicts are flagged only for genuinely different places at the same time (same venue is fine).
-- ADDITIVE ONLY (plus a replaced hub_invite_to_help). Rollback: docs/sql/rollback-20261019000400.sql

-- ---------------------------------------------------------------------------
-- Where and when an active assignment needs someone. Unknown event finish → treated as the start
-- instant only (we never invent a finish).
-- ---------------------------------------------------------------------------
create function public._hub_assignment_window(p_a public.hub_assignments)
returns table (place text, place_name text, starts_at timestamptz, ends_at timestamptz, what text)
language sql stable security definer set search_path = '' as $$
  select
    case when p_a.scope = 'venue' then 'venue:' || p_a.venue_id
         when e.venue_id is not null then 'venue:' || e.venue_id else 'event:' || e.id end,
    coalesce(v.name, e.external_location_text, ve.name),
    coalesce(p_a.begins_at, e.starts_at),
    coalesce(p_a.ends_at, e.ends_at, coalesce(p_a.begins_at, e.starts_at) + interval '1 minute'),
    coalesce(p_a.responsibility_label, case when p_a.scope = 'venue' then 'Venue cover' else e.title end)
  from (select 1) one
  left join public.events e on e.id = p_a.event_id
  left join public.venues v on v.id = p_a.venue_id
  left join public.venues ve on ve.id = e.venue_id
$$;

-- Active commitments of a person that would need them somewhere ELSE at the same time.
create function public._hub_conflicts(p_person_id uuid, p_place text, p_starts timestamptz, p_ends timestamptz, p_exclude uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('assignment_id', a.id, 'what', w.what, 'where', w.place_name,
                                               'starts_at', w.starts_at, 'ends_at', w.ends_at) order by w.starts_at), '[]'::jsonb)
  from public.hub_assignments a
  cross join lateral public._hub_assignment_window(a) w
  left join public.events e on e.id = a.event_id
  where a.person_id = p_person_id and a.state in ('pending', 'confirmed', 'needs_reconfirmation')
    and a.id is distinct from p_exclude
    and (e.id is null or e.status not in ('cancelled'))
    and w.place <> p_place
    and w.starts_at < p_ends and p_starts < w.ends_at
$$;

-- ---------------------------------------------------------------------------
-- Venue cover: create / change / respond (respond & cancel reuse the Stage 3 functions)
-- p_mode: 'request' | 'record_confirmed'. p_override_note: required to save despite a conflict.
-- ---------------------------------------------------------------------------
create function public.hub_create_venue_cover(p_venue_id uuid, p_person_id uuid, p_begins timestamptz, p_ends timestamptz,
                                              p_label text default null, p_mode text default 'request', p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_label text := public._hub_clean(p_label, 80);
  v_conf jsonb;
  v_has_account boolean;
  v_id uuid;
  v_dup uuid;
begin
  if not public.hub_can_manage_venue(p_venue_id) then perform public._fail('not_authorised', 'You can only arrange cover at your venues.'); end if;
  if not exists (select 1 from public.venues where id = p_venue_id and active) then perform public._fail('venue_inactive', 'That venue is inactive.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  if p_begins is null or p_ends is null or p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_ends - p_begins > interval '24 hours' then perform public._fail('invalid_times', 'Cover can last at most 24 hours.'); end if;
  if p_ends <= now() then perform public._fail('invalid_times', 'That time has already passed.'); end if;

  -- Idempotent: the same person, venue, responsibility and times already live → return it.
  select id into v_dup from public.hub_assignments
   where scope = 'venue' and venue_id = p_venue_id and person_id = p_person_id and begins_at = p_begins and ends_at = p_ends
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation');
  if v_dup is not null then return jsonb_build_object('assignment_id', v_dup, 'status', 'already_exists'); end if;

  v_conf := public._hub_conflicts(p_person_id, 'venue:' || p_venue_id, p_begins, p_ends);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(p_override_note, 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note explaining why.');
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null) into v_has_account;
  insert into public.hub_assignments (person_id, scope, venue_id, responsibility_label, begins_at, ends_at, state, invitation_source,
                                      response_source, recorded_by_person_id, requested_by_person_id, responded_at, conflict_override_note)
  values (p_person_id, 'venue', p_venue_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end,
          case when jsonb_array_length(v_conf) > 0 then public._hub_clean(p_override_note, 500) end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    perform public._hub_notify('venue_cover_request', p_person_id, 'hub_assignments', v_id, '{}'::jsonb, 'venue_cover_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'conflicts', v_conf);
end;
$$;

-- Change the times or responsibility of ONE venue cover (every derived event view follows).
-- If it was confirmed and the times change, it needs reconfirming unless the organiser records
-- that the person has agreed to the change (p_agreed).
create function public.hub_update_venue_cover(p_assignment_id uuid, p_begins timestamptz, p_ends timestamptz, p_label text,
                                              p_agreed boolean default false, p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
  v_conf jsonb;
  v_times_changed boolean;
  v_state text;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id and scope = 'venue' for update;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_venue(v_a.venue_id) then perform public._fail('not_authorised'); end if;
  if v_a.state in ('cancelled', 'declined') then perform public._fail('invalid_transition', 'This cover is ' || v_a.state || '. Add a new one instead.'); end if;
  if p_begins is null or p_ends is null or p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_ends - p_begins > interval '24 hours' then perform public._fail('invalid_times', 'Cover can last at most 24 hours.'); end if;
  v_conf := public._hub_conflicts(v_a.person_id, 'venue:' || v_a.venue_id, p_begins, p_ends, v_a.id);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(coalesce(p_override_note, v_a.conflict_override_note), 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note.');
  end if;
  v_times_changed := p_begins <> v_a.begins_at or p_ends <> v_a.ends_at;
  v_state := case when v_a.state = 'confirmed' and v_times_changed and not coalesce(p_agreed, false) then 'needs_reconfirmation' else v_a.state end;
  update public.hub_assignments set begins_at = p_begins, ends_at = p_ends, responsibility_label = public._hub_clean(p_label, 80),
    state = v_state,
    response_source = case when v_a.state = 'confirmed' and v_times_changed and coalesce(p_agreed, false) then 'admin_recorded' else response_source end,
    recorded_by_person_id = case when v_a.state = 'confirmed' and v_times_changed and coalesce(p_agreed, false) then v_me else recorded_by_person_id end,
    conflict_override_note = case when jsonb_array_length(v_conf) > 0 then coalesce(public._hub_clean(p_override_note, 500), conflict_override_note) else null end
  where id = p_assignment_id;
  if v_state = 'needs_reconfirmation' and v_a.state <> 'needs_reconfirmation' then
    perform public._hub_notify('assignment_reconfirm', v_a.person_id, 'hub_assignments', v_a.id, '{}'::jsonb,
                               'assignment_reconfirm:' || v_a.id || ':' || extract(epoch from now())::bigint);
  end if;
  return jsonb_build_object('state', v_state, 'conflicts', v_conf);
end;
$$;

-- Preview while arranging cover: the club events it would overlap (derived, nothing is linked),
-- and anything that would clash for this person.
create function public.hub_venue_cover_preview(p_venue_id uuid, p_begins timestamptz, p_ends timestamptz, p_person_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
                                                            'status', e.status, 'coverage', c.coverage) order by e.starts_at)
                        from public.events e cross join lateral (select public._hub_cover_kind(p_begins, p_ends, e.starts_at, e.ends_at) coverage) c
                        where e.venue_id = p_venue_id and e.status <> 'cancelled' and c.coverage is not null), '[]'::jsonb),
    'conflicts', case when p_person_id is null then '[]'::jsonb else public._hub_conflicts(p_person_id, 'venue:' || p_venue_id, p_begins, p_ends) end);
end;
$$;

-- How a cover window relates to an event window. NULL = no (claimable) overlap.
create function public._hub_cover_kind(p_cb timestamptz, p_ce timestamptz, p_es timestamptz, p_ee timestamptz) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_ee is null then case when p_cb <= p_es and p_ce > p_es then 'at_start_only' end
    when p_cb < p_ee and p_ce > p_es then case when p_cb <= p_es and p_ce >= p_ee then 'full' else 'partial' end
  end
$$;

-- Confirmed venue cover overlapping one event (derived; read-only context on the event page).
create function public.hub_venue_cover_for_event(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name),
                                               'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at, 'coverage', k.coverage)
                            order by a.begins_at), '[]'::jsonb)
  from public.events e
  join public.hub_assignments a on a.scope = 'venue' and a.venue_id = e.venue_id and a.state = 'confirmed'
  join public.people p on p.id = a.person_id
  cross join lateral (select public._hub_cover_kind(a.begins_at, a.ends_at, e.starts_at, e.ends_at) coverage) k
  where e.id = p_event_id and k.coverage is not null
$$;

-- Event involvement now includes derived venue cover (Stage 3 function, extended).
create or replace function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  v_mgr boolean;
  v_event public.events%rowtype;
  v_day date;
begin
  if v_me is null then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or (v_event.status = 'draft' and not public.hub_can_manage_event(p_event_id)) then perform public._fail('not_found'); end if;
  v_mgr := public.hub_can_manage_event(p_event_id);
  v_day := (v_event.starts_at at time zone 'Europe/London')::date;
  return jsonb_build_object(
    'can_manage', v_mgr,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'label', a.responsibility_label,
        'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
        'invitation_source', a.invitation_source, 'responded_at', a.responded_at, 'cancel_reason', case when v_mgr then a.cancel_reason end,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = a.recorded_by_person_id) end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by a.state, a.begins_at nulls first)
      from public.hub_assignments a join public.people p on p.id = a.person_id
      where a.scope = 'event' and a.event_id = p_event_id
        and (v_mgr or a.state in ('confirmed', 'needs_reconfirmation') or a.person_id = v_me)), '[]'::jsonb),
    'venue_cover', case when v_event.status = 'cancelled' then '[]'::jsonb else public.hub_venue_cover_for_event(p_event_id) end,
    'expected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', tp.person_id, 'name', coalesce(p.display_name, p.full_name), 'role', tp.role_label,
        'override', x.override, 'override_note', case when v_mgr then x.note end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by tp.role_label, p.full_name)
      from public.team_people tp join public.people p on p.id = tp.person_id
      left join public.event_participation_exceptions x on x.event_id = p_event_id and x.person_id = tp.person_id
      where v_event.team_id is not null and tp.team_id = v_event.team_id and tp.is_expected_by_default
        and p.lifecycle_status = 'active' and tp.active_from <= v_day and (tp.active_to is null or tp.active_to >= v_day)
        and (v_mgr or x.override is distinct from 'not_expected')), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', ea.person_id, 'name', coalesce(p.display_name, p.full_name), 'response', ea.response,
        'for_full_event', ea.for_full_event, 'available_from', ea.available_from, 'available_until', ea.available_until,
        'needs_admin_check', case when v_mgr then ea.needs_admin_check end, 'response_source', ea.response_source,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = ea.recorded_by_person_id) end,
        'responded_at', ea.responded_at,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by ea.responded_at)
      from public.event_availability ea join public.people p on p.id = ea.person_id
      where ea.event_id = p_event_id and (v_mgr or ea.response = 'yes' or ea.person_id = v_me)), '[]'::jsonb),
    'requests', case when v_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id, 'name', coalesce(p.display_name, p.full_name), 'requested_at', r.requested_at,
        'delivery_state', r.delivery_state, 'replied', exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id),
        'email', p.email_normalized::text, 'phone', p.phone_normalized) order by p.full_name)
      from public.availability_requests r join public.people p on p.id = r.person_id
      where r.event_id = p_event_id), '[]'::jsonb) else '[]'::jsonb end,
    'my_request', exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = v_me));
end;
$$;

-- Venue cover in a date range: confirmed cover for everyone (name, responsibility, times — no contact
-- details); organisers in scope also see pending/needs-reconfirmation cover and contact details.
-- Each row carries how many club events it overlaps ("Also supports N events").
create function public.hub_venue_covers(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'venue_id', a.venue_id, 'label', a.responsibility_label,
      'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
      'can_manage', public.hub_can_manage_venue(a.venue_id), 'conflict_override_note', case when public.hub_can_manage_venue(a.venue_id) then a.conflict_override_note end,
      'phone', case when public.hub_can_manage_venue(a.venue_id) then p.phone_normalized end,
      'events', (select count(*) from public.events e where e.venue_id = a.venue_id and e.status not in ('cancelled', 'draft')
                   and public._hub_cover_kind(a.begins_at, a.ends_at, e.starts_at, e.ends_at) is not null))
      order by a.begins_at)
    from public.hub_assignments a join public.people p on p.id = a.person_id
    where a.scope = 'venue' and a.begins_at < p_to and a.ends_at > p_from
      and (a.state = 'confirmed' or a.person_id = v_me
           or (public.hub_can_manage_venue(a.venue_id) and a.state in ('pending', 'needs_reconfirmation', 'declined')))), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organiser overview for a date range (spec 01 §12): per event, UNIQUE people by status;
-- per day, unique people across all events and venue cover (Kelly counts once).
-- ---------------------------------------------------------------------------
create function public.hub_manage_overview(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'kickoff_at', e.kickoff_at,
        'venue_id', e.venue_id, 'external_location_text', e.external_location_text, 'team_id', e.team_id, 'status', e.status,
        'volunteers_enabled', e.volunteers_enabled, 'category', e.category, 'is_demo', e.is_demo,
        'counts', public._hub_event_counts(e.id)) order by e.starts_at)
      from public.events e
      where e.starts_at >= p_from and e.starts_at < p_to and e.status <> 'draft' and public.hub_can_manage_event(e.id)), '[]'::jsonb),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'people', d.people) order by d.day)
      from (select x.day, count(distinct x.person_id) people from (
              select (coalesce(a.begins_at, e.starts_at) at time zone 'Europe/London')::date as day, a.person_id
                from public.hub_assignments a left join public.events e on e.id = a.event_id
               where a.state = 'confirmed' and coalesce(a.begins_at, e.starts_at) >= p_from and coalesce(a.begins_at, e.starts_at) < p_to
                 and (e.id is null or e.status <> 'cancelled')
                 and (a.scope = 'venue' and public.hub_can_manage_venue(a.venue_id) or a.scope = 'event' and public.hub_can_manage_event(a.event_id))
            ) x group by x.day) d), '[]'::jsonb),
    'drafts', (select count(*) from public.events e where e.status = 'draft' and e.starts_at >= now() and public.hub_can_manage_event(e.id)),
    'needs_check', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'name', coalesce(p.display_name, p.full_name)))
      from public.event_availability ea join public.events e on e.id = ea.event_id join public.people p on p.id = ea.person_id
      where ea.needs_admin_check and e.starts_at >= now() and e.status = 'published' and public.hub_can_manage_event(e.id)), '[]'::jsonb));
end;
$$;

-- Unique people per status for one event, each person counted once in their strongest status:
-- confirmed (incl. venue cover) > expected > available > pending.
create function public._hub_event_counts(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with e as (select * from public.events where id = p_event_id),
  confirmed as (
    select a.person_id from public.hub_assignments a where a.scope = 'event' and a.event_id = p_event_id and a.state = 'confirmed'
    union select (c ->> 'person_id')::uuid from jsonb_array_elements(public.hub_venue_cover_for_event(p_event_id)) c
    union select x.person_id from public.event_participation_exceptions x where x.event_id = p_event_id and x.override = 'confirmed_by_admin'),
  expected as (
    select tp.person_id from e join public.team_people tp on tp.team_id = e.team_id and tp.is_expected_by_default
    join public.people p on p.id = tp.person_id and p.lifecycle_status = 'active'
    where tp.active_from <= (e.starts_at at time zone 'Europe/London')::date
      and (tp.active_to is null or tp.active_to >= (e.starts_at at time zone 'Europe/London')::date)
      and not exists (select 1 from public.event_participation_exceptions x where x.event_id = p_event_id and x.person_id = tp.person_id)
    except select person_id from confirmed),
  available as (
    select ea.person_id from public.event_availability ea where ea.event_id = p_event_id and ea.response = 'yes'
    except select person_id from confirmed except select person_id from expected),
  pending as (
    select a.person_id from public.hub_assignments a where a.scope = 'event' and a.event_id = p_event_id and a.state in ('pending', 'needs_reconfirmation')
    except select person_id from confirmed),
  unanswered as (
    select r.person_id from public.availability_requests r where r.event_id = p_event_id
      and not exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id))
  select jsonb_build_object('confirmed', (select count(*) from confirmed), 'expected', (select count(*) from expected),
                            'available', (select count(*) from available), 'pending', (select count(*) from pending),
                            'unanswered', (select count(*) from unanswered))
$$;

-- ---------------------------------------------------------------------------
-- Direct invitations now also warn about clashes at another place (replaces the Stage 3 version).
-- ---------------------------------------------------------------------------
drop function public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text);
create function public.hub_invite_to_help(p_event_id uuid, p_person_id uuid, p_label text default null,
                                          p_begins timestamptz default null, p_ends timestamptz default null,
                                          p_mode text default 'request', p_override_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_label text := public._hub_clean(p_label, 80);
  v_has_account boolean;
  v_existing public.hub_assignments%rowtype;
  v_id uuid;
  v_delivery text := 'not_sent';
  v_conf jsonb;
  v_place text;
  v_s timestamptz;
  v_e timestamptz;
begin
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_event.status in ('cancelled', 'completed') then perform public._fail('event_not_open', 'This event is ' || v_event.status || '.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_begins is not null and p_ends is not null and p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_mode = 'request' and v_event.status = 'draft' then
    perform public._fail('event_not_open', 'Publish the event before asking people, so they can see it.');
  end if;

  select * into v_existing from public.hub_assignments
   where scope = 'event' and event_id = p_event_id and person_id = p_person_id
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation')
   for update;
  if found then
    if p_mode = 'record_confirmed' and v_existing.state <> 'confirmed' then
      update public.hub_assignments set state = 'confirmed', response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
       where id = v_existing.id;
      return jsonb_build_object('assignment_id', v_existing.id, 'status', 'recorded_confirmed', 'existing', true);
    end if;
    return jsonb_build_object('assignment_id', v_existing.id, 'status', 'already_' || v_existing.state, 'existing', true);
  end if;

  v_place := case when v_event.venue_id is not null then 'venue:' || v_event.venue_id else 'event:' || v_event.id end;
  v_s := coalesce(p_begins, v_event.starts_at);
  v_e := coalesce(p_ends, v_event.ends_at, v_s + interval '1 minute');
  v_conf := public._hub_conflicts(p_person_id, v_place, v_s, v_e);
  if jsonb_array_length(v_conf) > 0 and public._hub_clean(p_override_note, 500) is null then
    perform public._fail('conflict', 'This person is already needed somewhere else at an overlapping time. Change the times, or save anyway with a note explaining why.');
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null)
    into v_has_account;
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at,
                                      conflict_override_note)
  values (p_person_id, 'event', p_event_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end,
          case when jsonb_array_length(v_conf) > 0 then public._hub_clean(p_override_note, 500) end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    v_delivery := public._hub_notify('assignment_request', p_person_id, 'hub_assignments', v_id,
                                     jsonb_build_object('event_id', p_event_id), 'assignment_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'delivery', v_delivery, 'existing', false, 'conflicts', v_conf);
end;
$$;

grant execute on function
  public.hub_create_venue_cover(uuid, uuid, timestamptz, timestamptz, text, text, text),
  public.hub_update_venue_cover(uuid, timestamptz, timestamptz, text, boolean, text),
  public.hub_venue_cover_preview(uuid, timestamptz, timestamptz, uuid),
  public.hub_venue_covers(timestamptz, timestamptz),
  public.hub_manage_overview(timestamptz, timestamptz),
  public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text, text)
to authenticated;
