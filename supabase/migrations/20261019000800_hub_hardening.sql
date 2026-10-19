-- Volunteer Hub — Stage 7 hardening after the independent security review.
-- Additive and reversible (docs/sql/rollback-20261019000800.sql). No data is changed.
--
-- 1. Legacy rota permissions now defer to the Hub. The old helpers read volunteers.role/is_active,
--    so disabling or demoting someone in the Hub left their old admin powers working through the
--    legacy functions. From now on a legacy identity exists only while the same person has an
--    enabled Hub account, and their legacy role IS their Hub access level.
-- 2. Direct INSERT/UPDATE on events (legacy coordinator path) is withdrawn: Hub event changes go
--    only through hub_create_event / hub_update_event, which handle reconfirmation.
-- 3. Admin-only notes are no longer readable by the person they are about (column privileges).
-- 5. Anonymising a person also removes their name from the audit history.
-- 4. Under-18s: not offered to coordinators in the people picker, and their names are not shown to
--    ordinary members on event pages.

-- ---------------------------------------------------------------------------
-- 1. Legacy identity and role follow the Hub account
create or replace function public.current_volunteer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.volunteers v
  join public.user_accounts ua on ua.person_id = v.id and ua.enabled and ua.auth_user_id = auth.uid()
  join public.people p on p.id = v.id and p.lifecycle_status = 'active'
  where v.auth_user_id = auth.uid() and v.is_active
$$;

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case ua.access_level
           when 'admin' then 'admin'::public.app_role
           when 'coordinator' then 'coordinator'::public.app_role
           else 'volunteer'::public.app_role end
  from public.volunteers v
  join public.user_accounts ua on ua.person_id = v.id and ua.enabled and ua.auth_user_id = auth.uid()
  join public.people p on p.id = v.id and p.lifecycle_status = 'active'
  where v.auth_user_id = auth.uid() and v.is_active
$$;

-- Any volunteer row created or changed through a legacy path after the Hub went in is mirrored
-- into people/user_accounts (same id, as the Stage 1 copy did), so the Hub stays the single
-- place where access is granted or removed. Hub-side changes are never copied back.
create function public._hub_mirror_volunteer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_level text := case new.role when 'admin' then 'admin' when 'coordinator' then 'coordinator' else 'member' end;
begin
  if tg_op = 'INSERT' then
    insert into public.people (id, full_name, display_name, email_normalized, lifecycle_status, involvement)
    values (new.id, new.display_name, new.display_name,
            case when exists (select 1 from public.people x where x.email_normalized = lower(new.email::text)) then null else lower(new.email::text) end,
            case when new.is_active then 'active' else 'inactive' end,
            case when new.role in ('admin', 'coordinator') then array['volunteer', 'official'] else array['volunteer'] end)
    on conflict (id) do nothing;
  elsif new.is_active is distinct from old.is_active then
    update public.people set lifecycle_status = case when new.is_active then 'active' else 'inactive' end where id = new.id;
  end if;
  if new.invited_at is not null or new.auth_user_id is not null then
    insert into public.user_accounts (person_id, auth_user_id, access_level, enabled, invited_at, invite_state, linked_at, last_invite_at)
    values (new.id, new.auth_user_id, v_level, new.is_active, new.invited_at, 'sent', new.linked_at, new.invited_at)
    on conflict (person_id) do update set
      auth_user_id = case when tg_op = 'UPDATE' and new.auth_user_id is distinct from old.auth_user_id then excluded.auth_user_id else public.user_accounts.auth_user_id end,
      linked_at    = coalesce(public.user_accounts.linked_at, excluded.linked_at),
      access_level = case when tg_op = 'UPDATE' and new.role is distinct from old.role then excluded.access_level else public.user_accounts.access_level end,
      enabled      = case when tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then excluded.enabled else public.user_accounts.enabled end;
  end if;
  return null;
end;
$$;
revoke all on function public._hub_mirror_volunteer() from public, anon, authenticated;
create trigger volunteers_mirror_to_hub after insert or update of auth_user_id, role, is_active, invited_at, linked_at
  on public.volunteers for each row execute function public._hub_mirror_volunteer();

-- ---------------------------------------------------------------------------
-- 2. No direct event writes from the browser
drop policy if exists events_manager_insert on public.events;
drop policy if exists events_manager_update on public.events;
revoke insert, update on public.events from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private notes: column-level select for members' own rows
do $$
declare
  r record; cols text;
begin
  for r in select * from (values ('people', 'notes_private'), ('position_holders', 'note_private'), ('position_interests', 'note_private')) as x(t, c)
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns where table_schema = 'public' and table_name = r.t and column_name <> r.c;
    execute format('revoke select on table public.%I from authenticated', r.t);
    execute format('grant select (%s) on table public.%I to authenticated', cols, r.t);
  end loop;
end $$;
-- NOTE: a column added to these tables later must be granted explicitly.

create function public.hub_person_notes(p_person_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  return (select notes_private from public.people where id = p_person_id);
end;
$$;
revoke all on function public.hub_person_notes(uuid) from public, anon;
grant execute on function public.hub_person_notes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4a. People picker: under-18s only for administrators
create or replace function public.hub_people_picker() returns table (person_id uuid, name text, has_account boolean, email text, phone text, routine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_admin boolean := public.hub_is_admin();
begin
  if not public.hub_is_manager() then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized::text, p.phone_normalized, p.routine_requests_enabled
  from public.people p where p.lifecycle_status = 'active' and (v_admin or not p.is_under_18)
  order by lower(coalesce(p.display_name, p.full_name));
end;
$$;

-- 4b. Event page: ordinary members don't see under-18s' names (organisers still do)
alter function public.hub_event_involvement(uuid) rename to _hub_event_involvement_all;
revoke all on function public._hub_event_involvement_all(uuid) from public, anon, authenticated;

create function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  r jsonb := public._hub_event_involvement_all(p_event_id);
  k text;
begin
  if (r ->> 'can_manage')::boolean then return r; end if;
  foreach k in array array['assignments', 'venue_cover', 'expected', 'availability'] loop
    r := jsonb_set(r, array[k], coalesce((
      select jsonb_agg(x) from jsonb_array_elements(r -> k) x
      where (x ->> 'person_id')::uuid = v_me
         or not exists (select 1 from public.people p where p.id = (x ->> 'person_id')::uuid and p.is_under_18)), '[]'::jsonb));
  end loop;
  return r;
end;
$$;
revoke all on function public.hub_event_involvement(uuid) from public, anon;
grant execute on function public.hub_event_involvement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Anonymise: scrub names from the audit history as well
create or replace function public.hub_anonymise_person(p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('admin');
begin
  if p_person_id = v_me then perform public._fail('self_lockout', 'You can''t anonymise yourself.'); end if;
  if not exists (select 1 from public.people where id = p_person_id) then perform public._fail('not_found'); end if;
  if exists (select 1 from public.user_accounts where person_id = p_person_id and access_level = 'admin' and enabled)
     and (select count(*) from public.user_accounts ua join public.people p on p.id = ua.person_id
          where ua.access_level = 'admin' and ua.enabled and p.lifecycle_status = 'active' and ua.person_id <> p_person_id) = 0 then
    perform public._fail('last_admin', 'The club must keep at least one active administrator.');
  end if;
  perform set_config('hub.audit_source', 'anonymise', true);
  update public.user_accounts set enabled = false, auth_user_id = null, invite_state = 'not_sent', last_invite_error = null where person_id = p_person_id;
  update public.people set full_name = 'Former volunteer', display_name = null, email_normalized = null, phone_normalized = null,
    preferred_contact_channel = null, notes_private = null, routine_requests_enabled = false, directory_visibility = 'private',
    share_email_with_members = false, share_phone_with_members = false, lifecycle_status = 'inactive'
  where id = p_person_id;
  delete from public.volunteer_preferences where person_id = p_person_id;
  delete from public.usual_availability where person_id = p_person_id;
  delete from public.volunteer_applications where linked_person_id = p_person_id;
  update public.notification_outbox set status = 'suppressed', error = 'anonymised' where recipient_person_id = p_person_id and status = 'pending';
  -- The legacy record (same id) can't hold a null email, so it gets a non-deliverable placeholder.
  update public.volunteers set display_name = 'Former volunteer', phone = null, is_active = false, auth_user_id = null,
    email = 'anonymised-' || replace(p_person_id::text, '-', '') || '@example.invalid'
  where id = p_person_id;
  -- Names stay out of the history too (contact details and notes are already redacted when logged).
  update public.audit_log
     set old_data = old_data - 'full_name' - 'display_name' - 'email' - 'phone' - 'notes_private' - 'reason' - 'removal_reason',
         new_data = new_data - 'full_name' - 'display_name' - 'email' - 'phone' - 'notes_private' - 'reason' - 'removal_reason'
   where (entity_type in ('people', 'volunteers', 'user_accounts') and entity_id = p_person_id)
      or (old_data ->> 'person_id')::uuid = p_person_id or (new_data ->> 'person_id')::uuid = p_person_id
      or (old_data ->> 'volunteer_id')::uuid = p_person_id or (new_data ->> 'volunteer_id')::uuid = p_person_id;
  perform public._hub_audit('person_anonymised', 'people', p_person_id, null, null, 'anonymise');
end;
$$;
