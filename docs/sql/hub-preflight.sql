-- Volunteer Hub preflight: READ-ONLY checks to run against the live database before applying the Hub
-- migrations. Every "problem_rows" should be 0. Safe to run any time (select statements only).
select 'volunteers whose name is too long for people.full_name (max 120)' as check_name, count(*) as problem_rows
  from public.volunteers where char_length(btrim(display_name)) > 120
union all
select 'events with a kick-off after their end (new events_kickoff_within)', count(*)
  from public.events where kickoff_at is not null and ends_at is not null and kickoff_at > ends_at
union all
select 'events without a venue (new events_has_location needs venue or outside location)', count(*)
  from public.events where venue_id is null
union all
select 'club_settings row missing (Hub settings update id = 1)', case when exists (select 1 from public.club_settings where id = 1) then 0 else 1 end
union all
select 'volunteers sharing an email once lower-cased (people.email_normalized is unique)', count(*) from (
  select lower(email::text) from public.volunteers group by 1 having count(*) > 1) d
union all
select 'Auth users linked to two volunteers (user_accounts.auth_user_id is unique)', count(*) from (
  select auth_user_id from public.volunteers where auth_user_id is not null group by 1 having count(*) > 1) d
union all
select 'Hub tables already present (migrations applied before?)', count(*)
  from pg_tables where schemaname = 'public' and tablename in ('people', 'user_accounts', 'hub_assignments', 'club_positions', 'volunteer_applications')
union all
select 'shift assignments that would need manual review (none are converted automatically)', count(*)
  from public.assignments where status in ('invited', 'pending_approval', 'confirmed');
