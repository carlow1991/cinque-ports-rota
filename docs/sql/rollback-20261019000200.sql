-- Rollback for 20261019000200_hub_calendar.sql (Volunteer Hub · Stage 2).
-- Restores the original events constraints. It REFUSES to run (and changes nothing) if any event now
-- relies on the new freedoms (no venue, or no finish time), because putting NOT NULL back would mean
-- deleting or inventing data. Resolve those events first (give them a venue/finish, or export them).
-- Run in one transaction:  psql -1 -f this-file

do $$
begin
  if exists (select 1 from public.events where venue_id is null or ends_at is null) then
    raise exception 'rollback_blocked: % event(s) have no venue or no finish time. Export or update them first.',
      (select count(*) from public.events where venue_id is null or ends_at is null);
  end if;
end $$;

drop function if exists public.hub_set_event_status(uuid, text, text);
drop function if exists public._hub_after_event_cancel(uuid);
drop function if exists public.hub_update_event(uuid, jsonb);
drop function if exists public._hub_after_event_change(uuid, boolean);
drop function if exists public.hub_create_event(jsonb);
drop function if exists public._hub_event_fields(jsonb, uuid);
drop function if exists public._hub_event_type(text);
drop policy if exists events_read_hub on public.events;
drop function if exists public.hub_can_manage_event(uuid);

drop index if exists public.events_category_starts_idx;
drop index if exists public.events_team_starts_idx;
alter table public.events
  drop constraint if exists events_has_location,
  drop constraint if exists events_kickoff_within,
  drop constraint events_valid_interval,
  drop constraint events_max_length;
alter table public.events
  add constraint events_valid_interval check (starts_at < ends_at),
  add constraint events_max_length check (ends_at - starts_at <= interval '24 hours'),
  alter column venue_id set not null,
  alter column ends_at set not null,
  alter column event_type drop default,
  drop column external_location_text, drop column category, drop column volunteers_enabled, drop column visibility,
  drop column organiser_person_id, drop column created_by_person_id, drop column last_changed_by_person_id, drop column cancel_reason;

-- Freemens Way was active before this migration.
update public.venues set active = true where code = 'freemens_way';
