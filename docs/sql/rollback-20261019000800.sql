-- Rollback for 20261019000800_hub_hardening.sql. Run in one transaction. Changes no data.
-- Restores the legacy helpers, direct event write policies, table-level select, and the
-- unfiltered event involvement function.

drop trigger if exists volunteers_mirror_to_hub on public.volunteers;
drop function if exists public._hub_mirror_volunteer();
drop function if exists public.hub_event_involvement(uuid);
alter function public._hub_event_involvement_all(uuid) rename to hub_event_involvement;
revoke all on function public.hub_event_involvement(uuid) from public, anon;
grant execute on function public.hub_event_involvement(uuid) to authenticated;

create or replace function public.hub_people_picker() returns table (person_id uuid, name text, has_account boolean, email text, phone text, routine boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.hub_is_manager() then perform public._fail('not_authorised'); end if;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized::text, p.phone_normalized, p.routine_requests_enabled
  from public.people p where p.lifecycle_status = 'active'
  order by lower(coalesce(p.display_name, p.full_name));
end;
$$;

drop function if exists public.hub_person_notes(uuid);
revoke select on public.people, public.position_holders, public.position_interests from authenticated;
grant select on public.people, public.position_holders, public.position_interests to authenticated;

grant insert (venue_id, team_id, coverage_event_id, title, event_type, starts_at, ends_at, kickoff_at, opponent,
              competition, description, instructions, site_responsibility, is_demo) on public.events to authenticated;
grant update (team_id, coverage_event_id, title, kickoff_at, opponent, competition, description, instructions,
              site_responsibility) on public.events to authenticated;
create policy events_manager_insert on public.events for insert to authenticated
  with check (public.can_manage_venue(venue_id) and status = 'draft' and site_cover_source = 'club_volunteer');
create policy events_manager_update on public.events for update to authenticated
  using (public.can_manage_venue(venue_id)) with check (public.can_manage_venue(venue_id));

create or replace function public.current_volunteer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.volunteers v
  where v.auth_user_id = auth.uid() and v.is_active
$$;
create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select v.role from public.volunteers v
  where v.auth_user_id = auth.uid() and v.is_active
$$;

-- Restore the Stage 7 version of hub_anonymise_person.
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
  perform public._hub_audit('person_anonymised', 'people', p_person_id, null, null, 'anonymise');
end;
$$;
