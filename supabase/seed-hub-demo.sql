-- ===========================================================================
-- HUB DEMO DATA: LOCAL DEVELOPMENT / STAGING REHEARSAL ONLY — EXAMPLE, NOT PRODUCTION
-- Run by hand against a local or staging database:  psql "$DATABASE_URL" -f supabase/seed-hub-demo.sql
-- `supabase db push` never runs this file.
--
-- Mirrors the owner's demo script (docs/hub/05_ACCEPTANCE_TESTS.md): fictional people with
-- example.invalid addresses, DEMO-labelled events (is_demo = true, so any message is suppressed),
-- one venue-wide café cover across three overlapping Saturday events, club roles with recruiting flags.
-- Nobody gets a login, nothing is queued for sending.
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.events where not is_demo) then
    raise exception 'Refusing to load Hub DEMO data: this database already contains real events.';
  end if;
  if exists (select 1 from public.people where full_name like 'DEMO %') then
    raise exception 'Hub DEMO data is already loaded.';
  end if;
end $$;

do $$
declare
  uk constant text := 'Europe/London';
  mw uuid := (select id from public.venues where code = 'marke_wood');
  sat date := (date_trunc('week', (now() at time zone uk)::date) + interval '12 days')::date;
  sun date := sat + 1;
  t_u9 uuid; t_vets uuid; t_ladies uuid;
  scott uuid; kelly uuid; bob uuid; steve uuid; adam uuid; riley uuid; carl uuid;
  e_mini uuid; e_youth uuid; e_vets uuid; e_ladies uuid;
  p_sec uuid; p_ground uuid;
begin
  insert into public.teams (name) values ('DEMO U9'), ('DEMO Veterans'), ('DEMO Ladies') on conflict (name) do nothing;
  t_u9 := (select id from public.teams where name = 'DEMO U9');
  t_vets := (select id from public.teams where name = 'DEMO Veterans');
  t_ladies := (select id from public.teams where name = 'DEMO Ladies');

  -- People: a record is not a login. Only Kelly is suggested for routine requests.
  insert into public.people (full_name, involvement) values ('DEMO Scott', '{manager}') returning id into scott;
  insert into public.people (full_name, email_normalized, involvement, routine_requests_enabled)
    values ('DEMO Kelly', 'kelly@example.invalid', '{volunteer}', true) returning id into kelly;
  insert into public.people (full_name, email_normalized, involvement) values ('DEMO Bob', 'bob@example.invalid', '{volunteer}') returning id into bob;
  insert into public.people (full_name, phone_normalized, involvement) values ('DEMO Steve', '07700900123', '{volunteer}') returning id into steve;
  insert into public.people (full_name, involvement, routine_requests_enabled) values ('DEMO Adam', '{volunteer}', true) returning id into adam;
  insert into public.people (full_name, involvement, routine_requests_enabled) values ('DEMO Riley', '{volunteer}', true) returning id into riley;
  insert into public.people (full_name, involvement) values ('DEMO Carl', '{official}') returning id into carl;
  insert into public.volunteer_preferences (person_id, interests, strengths, commitment_bucket)
    values (kelly, '{refreshments,matchday_support}', '{customer_service}', '2to4');

  -- Scott manages the U9s and is expected at their events (not "confirmed").
  insert into public.team_people (team_id, person_id, role_label, is_expected_by_default, active_from)
    values (t_u9, scott, 'Manager', true, sat - 30);

  -- Three overlapping Saturday events at Marke Wood; the Veterans game has no recorded finish.
  insert into public.events (venue_id, team_id, title, category, starts_at, ends_at, status, is_demo)
    values (mw, null, 'DEMO Mini Kickers', 'mini_kickers', (sat + time '09:00') at time zone uk, (sat + time '11:00') at time zone uk, 'published', true)
    returning id into e_mini;
  insert into public.events (venue_id, team_id, title, category, starts_at, ends_at, status, volunteers_enabled, is_demo)
    values (mw, t_u9, 'DEMO Youth Home Fixtures', 'youth', (sat + time '09:00') at time zone uk, (sat + time '12:00') at time zone uk, 'published', true, true)
    returning id into e_youth;
  insert into public.events (venue_id, team_id, title, category, starts_at, ends_at, status, is_demo)
    values (mw, t_vets, 'DEMO Veterans v Example Town', 'match', (sat + time '10:30') at time zone uk, null, 'published', true)
    returning id into e_vets;
  -- Sunday: away Ladies fixture at a typed location (no venue created).
  insert into public.events (venue_id, external_location_text, team_id, title, category, starts_at, ends_at, status, volunteers_enabled, is_demo)
    values (null, 'Example Rec Ground (away)', t_ladies, 'DEMO Ladies at Example Rovers', 'match',
            (sun + time '14:00') at time zone uk, (sun + time '15:45') at time zone uk, 'published', true, true)
    returning id into e_ladies;
  insert into public.events (venue_id, external_location_text, title, category, starts_at, ends_at, status, is_demo)
    values (null, 'Example Community Centre', 'DEMO League meeting', 'meeting',
            (sun + 2 + time '19:30') at time zone uk, (sun + 2 + time '21:00') at time zone uk, 'published', true);

  -- ONE venue-wide café cover for Kelly 09:00–13:00 (recorded as agreed by an organiser).
  insert into public.hub_assignments (person_id, scope, venue_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at)
    values (kelly, 'venue', mw, 'Café', (sat + time '09:00') at time zone uk, (sat + time '13:00') at time zone uk, 'confirmed',
            'offline', 'admin_recorded', carl, carl, now());

  -- Ladies fixture: Bob confirmed himself, Steve declined (recorded from a phone call).
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, state, invitation_source, response_source, requested_by_person_id, responded_at)
    values (bob, 'event', e_ladies, 'Matchday support', 'confirmed', 'portal', 'self', carl, now());
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, state, invitation_source, response_source,
                                      recorded_by_person_id, requested_by_person_id, responded_at)
    values (steve, 'event', e_ladies, 'Matchday support', 'declined', 'offline', 'admin_recorded', carl, carl, now());

  -- Youth fixtures: Adam and Riley were asked; Adam said yes, Riley hasn't replied.
  insert into public.availability_requests (event_id, person_id, requested_by_person_id, delivery_state)
    values (e_youth, adam, carl, 'manual_contact'), (e_youth, riley, carl, 'manual_contact');
  insert into public.event_availability (event_id, person_id, response, for_full_event, response_source)
    values (e_youth, adam, 'yes', true, 'self');

  -- Club roles: Carl holds both; Secretary seeks a replacement, Groundsman wants extra help.
  insert into public.club_positions (title, department, public_summary, public_visible, seeking_replacement)
    values ('DEMO Club Secretary', 'Committee', 'Keeps the club organised: meetings, league paperwork and correspondence.', true, true)
    returning id into p_sec;
  insert into public.club_positions (title, department, public_summary, public_visible, seeking_additional_help)
    values ('DEMO Groundsman', 'Facilities', 'Helps keep the pitches at Marke Wood in good condition.', true, true)
    returning id into p_ground;
  insert into public.position_holders (club_position_id, person_id, start_date)
    values (p_sec, carl, sat - 365), (p_ground, carl, sat - 200);
end $$;
