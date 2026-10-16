-- ===========================================================================
-- DEMO DATA: LOCAL DEVELOPMENT ONLY
-- Loaded automatically by `supabase db reset` / `supabase start` on a LOCAL database.
-- `supabase db push` NEVER runs this file, so it cannot reach the club's real project.
--
-- Every event is is_demo = true and titled "DEMO …"; the outbox stores any message
-- for a demo event as 'suppressed', so demo data can never send a real email.
-- These are illustrative fixtures only, not real club fixtures.
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.events where not is_demo) then
    raise exception 'Refusing to load DEMO data: this database already contains real events.';
  end if;
end $$;

do $$
declare
  mw uuid := (select id from public.venues where code = 'marke_wood');
  fw uuid := (select id from public.venues where code = 'freemens_way');
  -- Next Saturday (UK date), and the Sunday after it.
  sat date := (date_trunc('week', (now() at time zone 'Europe/London')::date) + interval '12 days')::date;
  sun date := sat + 1;
  t01 uuid := (select id from public.duty_templates where code = 'T01');
  t03 uuid := (select id from public.duty_templates where code = 'T03');
  t05 uuid := (select id from public.duty_templates where code = 'T05');
  t08 uuid := (select id from public.duty_templates where code = 'T08');
  t09 uuid := (select id from public.duty_templates where code = 'T09');
  cover uuid; e uuid;
  uk constant text := 'Europe/London';
begin
  insert into public.teams (name) values ('DEMO First Team'), ('DEMO U9'), ('DEMO Ladies') on conflict (name) do nothing;

  -- Freemens Way Saturday operations 08:00–14:00 with one composite site lead (T09).
  insert into public.events (venue_id, title, event_type, starts_at, ends_at, status, is_demo)
  values (fw, 'DEMO Freemens Way Saturday operations', 'venue_coverage',
          (sat + time '08:00') at time zone uk, (sat + time '14:00') at time zone uk, 'published', true)
  returning id into cover;
  perform public._apply_template(cover, t09, null, '{}');

  -- Youth block 09:00–12:00 linked to that cover: no duplicate site lead (T03).
  insert into public.events (venue_id, team_id, title, event_type, starts_at, ends_at, status, coverage_event_id, is_demo)
  values (fw, (select id from public.teams where name = 'DEMO U9'), 'DEMO U7/U9 youth fixture block', 'fixture',
          (sat + time '09:00') at time zone uk, (sat + time '12:00') at time zone uk, 'published', cover, true)
  returning id into e;
  perform public._apply_template(e, t03, null, '{}');

  -- Overlapping second activity at the same venue, also using the shared cover.
  insert into public.events (venue_id, title, event_type, starts_at, ends_at, status, coverage_event_id, is_demo)
  values (fw, 'DEMO Additional club activity', 'club_event',
          (sat + time '12:00') at time zone uk, (sat + time '13:30') at time zone uk, 'draft', cover, true)
  returning id into e;
  insert into public.event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, instructions)
  values (e, (select id from public.duty_types where code = 'general_support'),
          (sat + time '12:00') at time zone uk, (sat + time '13:30') at time zone uk, 2, 'DEMO: help set out tables and greet visitors.');

  -- Marke Wood First Team at the same time as the Freemens Way morning (both venues busy), gate + tea bar on.
  insert into public.events (venue_id, team_id, title, event_type, starts_at, ends_at, kickoff_at, opponent, competition, status, is_demo)
  values (mw, (select id from public.teams where name = 'DEMO First Team'), 'DEMO First Team v Example Town', 'fixture',
          (sat + time '15:00') at time zone uk, (sat + time '16:50') at time zone uk, (sat + time '15:00') at time zone uk,
          'Example Town', 'DEMO League', 'published', true)
  returning id into e;
  perform public._apply_template(e, t01,
    (select array_agg(i.id) from public.duty_template_items i join public.duty_types d on d.id = i.duty_type_id
     where i.template_id = t01 and d.code in ('site_lead', 'gate_admissions', 'refreshments', 'pitch_setup', 'cleaning')), '{}');

  -- Sunday Ladies fixture left as a draft with T05-style "decision needed" training alongside.
  insert into public.events (venue_id, team_id, title, event_type, starts_at, ends_at, status, is_demo)
  values (mw, (select id from public.teams where name = 'DEMO Ladies'), 'DEMO Ladies training', 'training',
          (sun + time '10:00') at time zone uk, (sun + time '11:30') at time zone uk, 'draft', true)
  returning id into e;
  perform public._apply_template(e, t05, null, '{}');

  -- Maintenance party the following Sunday afternoon.
  insert into public.events (venue_id, title, event_type, starts_at, ends_at, status, is_demo)
  values (mw, 'DEMO Pitch-side working party', 'maintenance',
          (sun + 7 + time '13:00') at time zone uk, (sun + 7 + time '16:00') at time zone uk, 'draft', true)
  returning id into e;
  perform public._apply_template(e, t08, null, '{}');
end $$;
