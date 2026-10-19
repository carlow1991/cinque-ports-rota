-- Remove a former volunteer's personal details (e.g. after a UK GDPR erasure request).
-- Run in the Supabase dashboard → SQL Editor, by an administrator, ONE person at a time.
--
-- BEFORE running, in the app: take the person off any upcoming duties (so organisers are alerted
-- and cover is recalculated) and suspend them. This script refuses if they still have an upcoming
-- duty, if they are the last active administrator, or if the email isn't found.
--
-- What it does, in one transaction:
--   * replaces their name with "Former volunteer", clears phone and venue preference, replaces the
--     email with a non-deliverable placeholder, suspends and unlinks the sign-in account
--   * removes their coordinator venues and club authorisations
--   * removes their name, and any reasons written about them, from the audit history, their
--     cancellation requests, their duty records and copies of their emails
--   * stops any email still waiting to be sent to them
-- Past duty records stay (as "Former volunteer") so the club's history and counts remain correct.
--
-- AFTERWARDS: Authentication → Users → find the same email → Delete user.

do $$
declare
  v_email text := 'person@example.org';   -- ← change this, and only this
  v_id uuid;
begin
  select id into v_id from public.volunteers where email operator(extensions.=) lower(btrim(v_email))::extensions.citext;
  if v_id is null then raise exception 'No volunteer has that email address.'; end if;

  if exists (select 1 from public.assignments a join public.event_shifts s on s.id = a.shift_id
             where a.volunteer_id = v_id and a.status in ('confirmed', 'pending_approval', 'invited') and s.ends_at > now()) then
    raise exception 'This person still has upcoming duties. Remove them from those duties in the app first.';
  end if;
  if exists (select 1 from public.volunteers where id = v_id and role = 'admin' and is_active)
     and (select count(*) from public.volunteers where role = 'admin' and is_active and id <> v_id) = 0 then
    raise exception 'This is the last active administrator. Make someone else an administrator first.';
  end if;

  update public.volunteers
     set display_name = 'Former volunteer', phone = null, preferred_venue_id = null,
         email = format('removed+%s@invalid.example', id), is_active = false, auth_user_id = null,
         role = 'volunteer'
   where id = v_id;
  -- The Volunteer Hub record (same id), if there is one.
  update public.user_accounts set enabled = false, auth_user_id = null where person_id = v_id;
  update public.people set full_name = 'Former volunteer', display_name = null, email_normalized = null, phone_normalized = null,
         notes_private = null, preferred_contact_channel = null, lifecycle_status = 'inactive', directory_visibility = 'private',
         share_email_with_members = false, share_phone_with_members = false, routine_requests_enabled = false
   where id = v_id;
  delete from public.coordinator_venues where volunteer_id = v_id;
  delete from public.volunteer_duty_authorisations where volunteer_id = v_id;
  update public.cancellation_requests set reason = null where volunteer_id = v_id;
  update public.assignments set removal_reason = null where volunteer_id = v_id and removal_reason is not null;
  update public.notification_outbox set status = 'suppressed', error = 'recipient_removed'
   where recipient_volunteer_id = v_id and status in ('pending', 'sending');
  update public.notification_outbox set payload = payload - 'removal_reason' where recipient_volunteer_id = v_id;
  -- Last, so it also cleans the audit rows written by the statements above.
  update public.audit_log
     set old_data = old_data - 'display_name' - 'full_name' - 'reason' - 'removal_reason',
         new_data = new_data - 'display_name' - 'full_name' - 'reason' - 'removal_reason'
   where (entity_type in ('volunteers', 'people', 'user_accounts') and entity_id = v_id)
      or (old_data ->> 'person_id')::uuid = v_id or (new_data ->> 'person_id')::uuid = v_id
      or (entity_type = 'cancellation_requests' and entity_id in (select id from public.cancellation_requests where volunteer_id = v_id))
      or (old_data ->> 'volunteer_id')::uuid = v_id or (new_data ->> 'volunteer_id')::uuid = v_id;
  raise notice 'Done. Now delete the matching user under Authentication → Users.';
end $$;
