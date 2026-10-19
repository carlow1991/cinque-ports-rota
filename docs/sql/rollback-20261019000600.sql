-- Rollback for 20261019000600_hub_applications.sql (Volunteer Hub · Stage 6).
-- Drops volunteer applications (EXPORT them first — they are personal data the club holds), role
-- suggestions, rate-limit events and the new settings columns. Interest records that came only from
-- applications are removed with them. Run in one transaction:  psql -1 -f this-file

drop function if exists public.hub_application_counts();
drop function if exists public.hub_delete_application(uuid);
drop function if exists public.hub_recompute_suggestions(uuid);
drop function if exists public.hub_match_application_position(uuid, uuid);
drop function if exists public.hub_create_person_from_application(uuid, boolean);
drop function if exists public.hub_link_application(uuid, uuid);
drop function if exists public.hub_update_application(uuid, jsonb);
drop function if exists public._hub_app_audit(uuid, text, jsonb);
drop function if exists public.public_submit_application(jsonb, text);
drop function if exists public._hub_suggest_roles(uuid);

delete from public.position_interests where person_id is null and application_id is not null;
drop index if exists public.position_interests_application_uq;
alter table public.position_interests drop constraint if exists position_interests_application_fk;
update public.position_interests set application_id = null where application_id is not null;

drop table if exists public.hub_rate_events;
drop table if exists public.application_role_suggestions;
drop table if exists public.volunteer_applications;
alter table public.club_settings drop column if exists contact_email, drop column if exists applications_open,
  drop column if exists application_retention_months;
