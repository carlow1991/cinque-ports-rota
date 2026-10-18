-- Rollback for 20261019000400_hub_venue_cover.sql (Volunteer Hub · Stage 4).
-- Removes the venue-cover functions and overview. Venue-scope rows in hub_assignments are KEPT
-- (they are commitments) but no longer shown; export them first if you will also roll back Stage 3.
-- Restores the Stage 3 versions of hub_invite_to_help and hub_event_involvement.
-- Run in one transaction:  psql -1 -f this-file

drop function if exists public.hub_manage_overview(timestamptz, timestamptz);
drop function if exists public._hub_event_counts(uuid);
drop function if exists public.hub_venue_covers(timestamptz, timestamptz);
drop function if exists public.hub_venue_cover_preview(uuid, timestamptz, timestamptz, uuid);
drop function if exists public.hub_update_venue_cover(uuid, timestamptz, timestamptz, text, boolean, text);
drop function if exists public.hub_create_venue_cover(uuid, uuid, timestamptz, timestamptz, text, text, text);
drop function if exists public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text, text);

create function public.hub_invite_to_help(p_event_id uuid, p_person_id uuid, p_label text default null,
                                          p_begins timestamptz default null, p_ends timestamptz default null,
                                          p_mode text default 'request')
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

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null)
    into v_has_account;
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at)
  values (p_person_id, 'event', p_event_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    v_delivery := public._hub_notify('assignment_request', p_person_id, 'hub_assignments', v_id,
                                     jsonb_build_object('event_id', p_event_id), 'assignment_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'delivery', v_delivery, 'existing', false);
end;
$$;
grant execute on function public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text) to authenticated;

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

drop function if exists public.hub_venue_cover_for_event(uuid);
drop function if exists public._hub_cover_kind(timestamptz, timestamptz, timestamptz, timestamptz);
drop function if exists public._hub_conflicts(uuid, text, timestamptz, timestamptz, uuid);
drop function if exists public._hub_assignment_window(public.hub_assignments);
