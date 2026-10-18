-- Rollback for 20261019000100_hub_people.sql (Volunteer Hub · Stage 1).
-- Removes ONLY what that migration added. Legacy volunteers, venues, teams and audit rows are untouched;
-- Hub-only people (added after the migration) and their accounts are removed with the tables, so take a
-- backup / export of people first if any were added. Run in one transaction:  psql -1 -f this-file
-- Afterwards, deploy the legacy code (git tag legacy-rota-final) so sign-in uses link_volunteer_account again.

drop policy if exists venues_read_hub on public.venues;
drop policy if exists teams_read_hub on public.teams;
drop policy if exists duty_types_read_hub on public.duty_types;
drop policy if exists club_settings_read_hub on public.club_settings;
drop policy if exists audit_log_hub_admin_read on public.audit_log;
drop policy if exists venues_hub_admin_insert on public.venues;
drop policy if exists venues_hub_admin_update on public.venues;
drop policy if exists teams_hub_admin_insert on public.teams;
drop policy if exists teams_hub_admin_update on public.teams;
drop policy if exists duty_types_hub_admin_update on public.duty_types;
drop policy if exists club_settings_hub_admin_update on public.club_settings;

drop function if exists public.hub_directory();
drop function if exists public.hub_bootstrap_person(text, text, text);
drop function if exists public.hub_set_coordinator_scopes(uuid, uuid[], uuid[]);
drop function if exists public.hub_set_access(uuid, text, boolean);
drop function if exists public.hub_record_invite_result(uuid, text, text);
drop function if exists public.hub_prepare_portal_invite(uuid, text);
drop function if exists public.hub_set_team_role(uuid, uuid, uuid, text, boolean, date, date);
drop function if exists public.hub_create_team(text);
drop function if exists public.hub_update_my_profile(jsonb);
drop function if exists public.hub_set_preferences(uuid, jsonb);
drop function if exists public.hub_update_person(uuid, jsonb);
drop function if exists public.hub_create_person(jsonb);
drop function if exists public._hub_person_fields(jsonb);
drop function if exists public.hub_me();
drop function if exists public.link_person_account();

-- Restore the original audit trigger body (as in 20261016000300_integrity_guards.sql).
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_id  uuid;
  v_redact text[] := array['email', 'phone', 'auth_user_id'];
begin
  if v_old is not null then v_old := v_old - v_redact; end if;
  if v_new is not null then v_new := v_new - v_redact; end if;
  if tg_op = 'UPDATE' and v_old - 'updated_at' = v_new - 'updated_at' then
    return null;
  end if;
  v_id := (select x::uuid from unnest(array[v_new ->> 'id', v_old ->> 'id', v_new ->> 'volunteer_id', v_old ->> 'volunteer_id']) x
           where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1);
  insert into public.audit_log (actor_volunteer_id, action, entity_type, entity_id, old_data, new_data)
  values (public.current_volunteer_id(), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  return null;
end;
$$;

drop table if exists public.usual_availability;
drop table if exists public.volunteer_preferences;
drop table if exists public.team_people;
drop table if exists public.coordinator_scopes;
drop table if exists public.user_accounts;
alter table public.audit_log drop column if exists actor_person_id, drop column if exists source;
drop table if exists public.people;

drop function if exists public._hub_audit(text, text, uuid, jsonb, jsonb, text);
drop function if exists public._hub_require(text);
drop function if exists public.hub_can_manage_team(uuid);
drop function if exists public.hub_can_manage_venue(uuid);
drop function if exists public.hub_is_manager();
drop function if exists public.hub_is_admin();
drop function if exists public.current_access_level();
drop function if exists public.current_person_id();
drop function if exists public._hub_clean(text, int);
drop function if exists public._hub_normalize_phone(text);
