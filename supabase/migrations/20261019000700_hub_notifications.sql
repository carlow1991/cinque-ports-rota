-- Volunteer Hub · Stage 7: email for Hub actions through the EXISTING outbox, plus settings and privacy tools.
-- Messages are queued only by deliberate organiser/volunteer actions (requests, invitations, answers,
-- reconfirmations, cancellations) and day-before reminders. Never by creating a person, an event or an
-- application. Every existing safety gate still applies: EMAIL_SENDING_ENABLED, the admin release switch
-- (email held until an administrator starts it), the non-production allow-list, idempotency keys,
-- retries with back-off, and a re-check of every message just before it is sent.
-- ADDITIVE (+ replaced worker functions). Rollback: docs/sql/rollback-20261019000700.sql

alter table public.notification_outbox
  alter column recipient_volunteer_id drop not null,
  add column recipient_person_id uuid references public.people (id) on delete cascade,
  add constraint notification_outbox_has_recipient check (recipient_volunteer_id is not null or recipient_person_id is not null);
create index notification_outbox_person_idx on public.notification_outbox (recipient_person_id) where recipient_person_id is not null;

-- Recipient-safe payload: only what the recipient needs about THEIR request or commitment.
create function public._hub_payload(p_entity_type text, p_entity_id uuid, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    case p_entity_type
      when 'hub_assignments' then (
        select jsonb_build_object('assignment_id', a.id, 'state', a.state, 'scope', a.scope, 'duty', coalesce(a.responsibility_label, case when a.scope = 'venue' then 'Venue cover' else 'help' end),
          'event_id', e.id, 'event_title', coalesce(e.title, v.name), 'venue', coalesce(v.name, ve.name, e.external_location_text),
          'shift_starts_at', coalesce(a.begins_at, e.starts_at), 'shift_ends_at', coalesce(a.ends_at, e.ends_at),
          'demo', coalesce(e.is_demo, false), 'reason', a.cancel_reason)
        from public.hub_assignments a left join public.events e on e.id = a.event_id
        left join public.venues v on v.id = a.venue_id left join public.venues ve on ve.id = e.venue_id
        where a.id = p_entity_id)
      when 'availability_requests' then (
        select jsonb_build_object('request_id', r.id, 'event_id', e.id, 'event_title', e.title, 'venue', coalesce(ve.name, e.external_location_text),
          'shift_starts_at', e.starts_at, 'shift_ends_at', e.ends_at, 'duty', 'help', 'demo', e.is_demo)
        from public.availability_requests r join public.events e on e.id = r.event_id left join public.venues ve on ve.id = e.venue_id
        where r.id = p_entity_id)
    end), '{}'::jsonb) || coalesce(p_extra, '{}'::jsonb)
$$;

-- Queue one Hub message (replaces the Stage 3 no-op). Returns 'queued' or 'not_sent' (no email address
-- or no active Hub login to act on it — the organiser contacts them another way).
create or replace function public._hub_notify(p_kind text, p_person_id uuid, p_entity_type text, p_entity_id uuid,
                                              p_payload jsonb default '{}'::jsonb, p_key text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case p_kind when 'event_cancelled' then 'hub_event_cancelled' else p_kind end;
  v_payload jsonb;
  v_demo boolean;
  v_name text;
begin
  if p_person_id is null then return 'not_sent'; end if;
  if not exists (select 1 from public.people p join public.user_accounts ua on ua.person_id = p.id
                 where p.id = p_person_id and p.email_normalized is not null and p.lifecycle_status = 'active'
                   and ua.enabled and ua.auth_user_id is not null) then
    return 'not_sent';
  end if;
  -- Organiser messages name only the person who answered THEIR request.
  if v_kind in ('assignment_confirmed', 'assignment_declined', 'assignment_withdrawn') and (p_payload ? 'person_id') then
    select coalesce(display_name, full_name) into v_name from public.people where id = (p_payload ->> 'person_id')::uuid;
  end if;
  v_payload := public._hub_payload(p_entity_type, p_entity_id, jsonb_build_object('person_name', v_name));
  v_demo := coalesce((v_payload ->> 'demo')::boolean, false);
  insert into public.notification_outbox (recipient_person_id, kind, entity_type, entity_id, dedupe_key, payload, status)
  values (p_person_id, v_kind, p_entity_type, p_entity_id, coalesce(p_key, v_kind || ':' || p_entity_id || ':' || extract(epoch from now())::bigint),
          v_payload, case when v_demo then 'suppressed'::public.notification_status else 'pending' end)
  on conflict (dedupe_key) do nothing;
  return case when v_demo then 'not_sent' else 'queued' end;
end;
$$;

-- Why a pending message should no longer be sent (NULL = still true). Legacy cases unchanged; Hub
-- cases: the request/invitation must still be open, the commitment still in the described state.
create or replace function public._outbox_obsolete_reason(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when o.entity_type = 'assignments' and o.kind <> 'reminder' then (
      case
        when a.id is null then 'duty_gone'
        when a.status::text is distinct from (o.payload ->> 'status') then 'status_changed'
        when exists (select 1 from public.notification_outbox n
                     where n.entity_type = 'assignments' and n.entity_id = o.entity_id and n.kind <> 'reminder'
                       and n.recipient_volunteer_id = o.recipient_volunteer_id and n.created_at > o.created_at)
          then 'superseded'
      end)
    when o.kind = 'cancellation_requested' then (
      case when exists (select 1 from public.cancellation_requests c where c.id = o.entity_id and c.status = 'pending')
           then null else 'request_resolved' end)
    when o.kind = 'venue_cover_at_risk' then (
      case when exists (select 1 from public.events e where e.id = o.entity_id
                          and e.status in ('draft', 'published', 'postponed') and e.ends_at > now())
           then null else 'event_closed' end)
    when o.entity_type = 'availability_requests' then (
      case
        when r.id is null then 'request_gone'
        when re.status <> 'published' or not re.volunteers_enabled then 'event_not_open'
        when coalesce(re.ends_at, re.starts_at + interval '6 hours') <= now() then 'event_over'
        when exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id) then 'already_replied'
      end)
    when o.entity_type = 'hub_assignments' then (
      case
        when ha.id is null then 'commitment_gone'
        when he.id is not null and he.status = 'cancelled' and o.kind <> 'hub_event_cancelled' then 'event_cancelled'
        when o.kind in ('assignment_request', 'venue_cover_request') and ha.state <> 'pending' then 'already_answered'
        when o.kind = 'assignment_reconfirm' and ha.state <> 'needs_reconfirmation' then 'already_answered'
        when o.kind = 'hub_reminder' and (ha.state <> 'confirmed'
             or coalesce(ha.begins_at, he.starts_at) is distinct from (o.payload ->> 'shift_starts_at')::timestamptz) then 'commitment_changed'
      end)
  end
  from public.notification_outbox o
  left join public.assignments a on o.entity_type = 'assignments' and a.id = o.entity_id
  left join public.availability_requests r on o.entity_type = 'availability_requests' and r.id = o.entity_id
  left join public.events re on re.id = r.event_id
  left join public.hub_assignments ha on o.entity_type = 'hub_assignments' and ha.id = o.entity_id
  left join public.events he on he.id = ha.event_id
  where o.id = p_id
$$;

-- Active recipient (legacy volunteer or Hub person with an enabled login).
create function public._outbox_recipient_active(p_volunteer uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when p_person is not null then exists (
                select 1 from public.people p join public.user_accounts ua on ua.person_id = p.id
                where p.id = p_person and p.lifecycle_status = 'active' and ua.enabled and p.email_normalized is not null)
              else exists (select 1 from public.volunteers v where v.id = p_volunteer and v.is_active) end
$$;

create or replace function public.outbox_claim(p_limit int default 25)
returns table (id uuid, kind text, dedupe_key text, payload jsonb, attempt_count int,
               recipient_email text, recipient_name text)
language plpgsql security definer set search_path = '' as $$
declare v_from timestamptz := (select cs.email_released_from from public.club_settings cs where cs.id = 1);
begin
  update public.notification_outbox o set status = 'pending'
   where o.status = 'sending' and o.claimed_at < now() - interval '10 minutes';
  if v_from is null then return; end if;
  update public.notification_outbox o set status = 'suppressed', error = 'recipient_inactive'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from
     and not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id);
  update public.notification_outbox o set status = 'suppressed', error = 'duty_no_longer_active'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from and o.kind = 'reminder'
     and not exists (
       select 1 from public.assignments a
       join public.event_shifts s on s.id = a.shift_id
       join public.events e on e.id = s.event_id
       where a.id = o.entity_id and a.status = 'confirmed' and s.status = 'active'
         and e.status = 'published' and s.starts_at > now());
  update public.notification_outbox o set status = 'suppressed', error = r.reason
    from (select x.id, public._outbox_obsolete_reason(x.id) as reason from public.notification_outbox x
          where x.status = 'pending' and x.send_after <= now() and x.created_at >= v_from) r
   where o.id = r.id and r.reason is not null;
  -- Hub: a request whose message is suppressed shows as "not sent" to the organiser.
  update public.availability_requests r set delivery_state = 'not_sent'
    from public.notification_outbox o
   where o.entity_type = 'availability_requests' and o.entity_id = r.id and o.status = 'suppressed' and r.delivery_state = 'queued';
  return query
  with due as (
    select o.id from public.notification_outbox o
    where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from
    order by o.send_after, o.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set status = 'sending', attempt_count = o.attempt_count + 1, claimed_at = now(), last_attempt_at = now()
      from due where o.id = due.id
    returning o.id, o.kind, o.dedupe_key, o.payload, o.attempt_count, o.recipient_volunteer_id, o.recipient_person_id
  )
  select c.id, c.kind, c.dedupe_key, c.payload, c.attempt_count,
         coalesce(v.email::text, p.email_normalized::text), coalesce(v.display_name, p.display_name, p.full_name)
  from claimed c
  left join public.volunteers v on v.id = c.recipient_volunteer_id
  left join public.people p on p.id = c.recipient_person_id;
end;
$$;

-- Result recording, now also reflected on the availability request the organiser sees.
create or replace function public.outbox_complete(p_id uuid, p_ok boolean, p_error text default null,
                                                  p_provider_message_id text default null, p_retryable boolean default true)
returns public.notification_status
language plpgsql security definer set search_path = '' as $$
declare v public.notification_outbox%rowtype; v_status public.notification_status;
begin
  select * into v from public.notification_outbox where id = p_id for update;
  if not found or v.status <> 'sending' then return v.status; end if;
  if p_ok then
    update public.notification_outbox set status = 'sent', sent_at = now(), error = null,
           provider_message_id = left(p_provider_message_id, 200) where id = p_id;
    v_status := 'sent';
  else
    v_status := case when p_retryable and v.attempt_count < 5 then 'pending' else 'failed' end;
    update public.notification_outbox
       set status = v_status, error = left(regexp_replace(coalesce(p_error, 'unknown error'), '[^\s@]+@[^\s@]+', '[email]', 'g'), 300),
           send_after = case when v_status = 'pending' then now() + make_interval(mins => power(2, v.attempt_count)::int) else send_after end
     where id = p_id;
  end if;
  if v.entity_type = 'availability_requests' and v_status in ('sent', 'failed') then
    update public.availability_requests set delivery_state = v_status::text, sent_at = case when v_status = 'sent' then now() else sent_at end
     where id = v.entity_id and delivery_state in ('queued', 'failed', 'not_sent');
  end if;
  return v_status;
end;
$$;

create or replace function public.outbox_suppress(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.notification_outbox%rowtype;
begin
  update public.notification_outbox set status = 'suppressed', error = left(p_reason, 100)
   where id = p_id and status in ('pending', 'sending') returning * into v;
  if v.entity_type = 'availability_requests' then
    update public.availability_requests set delivery_state = 'not_sent' where id = v.entity_id and delivery_state = 'queued';
  end if;
end;
$$;

-- Day-before reminders, now also for confirmed Hub commitments (event or venue cover).
create or replace function public.outbox_enqueue_reminders(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tz text := coalesce((select timezone from public.club_settings where id = 1), 'Europe/London');
  v_on boolean := coalesce((select reminder_day_before from public.club_settings where id = 1), true);
  v_tomorrow date := (p_now at time zone v_tz)::date + 1;
  v_due timestamptz := ((v_tomorrow - 1) + time '18:00') at time zone v_tz;
  r record;
  n int := 0;
begin
  if not v_on then return 0; end if;
  if (select email_released_from from public.club_settings where id = 1) is null then return 0; end if;
  for r in
    select a.id, a.volunteer_id, e.is_demo
    from public.assignments a
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    join public.volunteers vol on vol.id = a.volunteer_id
    where a.status = 'confirmed' and s.status = 'active' and e.status = 'published' and vol.is_active
      and (s.starts_at at time zone v_tz)::date = v_tomorrow
      and not exists (select 1 from public.notification_outbox o where o.dedupe_key = format('reminder:%s:%s', a.id, v_tomorrow))
  loop
    perform public._enqueue(r.volunteer_id, 'reminder', 'assignments', r.id, format('reminder:%s:%s', r.id, v_tomorrow),
                            public._assignment_payload(r.id), r.is_demo, greatest(p_now, v_due));
    n := n + 1;
  end loop;
  for r in
    select ha.id, ha.person_id
    from public.hub_assignments ha left join public.events e on e.id = ha.event_id
    where ha.state = 'confirmed' and (e.id is null or e.status = 'published')
      and (coalesce(ha.begins_at, e.starts_at) at time zone v_tz)::date = v_tomorrow
      and not exists (select 1 from public.notification_outbox o where o.dedupe_key = format('hub_reminder:%s:%s', ha.id, v_tomorrow))
  loop
    if public._hub_notify('hub_reminder', r.person_id, 'hub_assignments', r.id, '{}'::jsonb, format('hub_reminder:%s:%s', r.id, v_tomorrow)) = 'queued' then
      update public.notification_outbox set send_after = greatest(p_now, v_due) where dedupe_key = format('hub_reminder:%s:%s', r.id, v_tomorrow);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Admin email tools: Hub administrators as well as legacy ones. Still no addresses, names or content.
create or replace function public.admin_outbox_summary()
returns table (status public.notification_status, kind text, message_count int, last_error text, oldest_due timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_admin() or public.hub_is_admin()) then return; end if;
  return query
  select o.status, o.kind, count(*)::int,
         (array_agg(o.error order by o.last_attempt_at desc nulls last) filter (where o.error is not null))[1],
         min(o.send_after)
  from public.notification_outbox o
  where o.created_at > now() - interval '30 days'
  group by o.status, o.kind
  order by o.status, o.kind;
end;
$$;

create or replace function public.admin_retry_failed_emails() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (public.is_admin() or public.hub_is_admin()) then perform public._fail('not_authorised', 'Only an administrator can retry emails.'); end if;
  update public.notification_outbox set status = 'pending', attempt_count = 0, send_after = now(), error = null
   where status = 'failed' and created_at > now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_email_backlog()
returns table (kind text, held int, still_current int, out_of_date int, recipients int, oldest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := (select cs.email_released_from from public.club_settings cs where cs.id = 1);
begin
  if not (public.is_admin() or public.hub_is_admin()) then return; end if;
  return query
  select o.kind, count(*)::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is null and public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is not null or not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         count(distinct coalesce(o.recipient_volunteer_id, o.recipient_person_id)) filter (
           where public._outbox_obsolete_reason(o.id) is null and public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id))::int,
         min(o.created_at)
  from public.notification_outbox o
  where o.status = 'pending' and (v_from is null or o.created_at < v_from)
  group by o.kind
  order by o.kind;
end;
$$;

create or replace function public.admin_set_email_release(p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (select email_released_from from public.club_settings where id = 1);
  v_held_before timestamptz := coalesce(v_from, 'infinity'::timestamptz);
  n_out int := 0; n_held int := 0;
begin
  if not (public.is_admin() or public.hub_is_admin()) then perform public._fail('not_authorised', 'Only an administrator can start or pause email.'); end if;
  if p_mode = 'pause' then
    update public.club_settings set email_released_from = null where id = 1;
    return jsonb_build_object('mode', 'pause');
  elsif p_mode not in ('new_only', 'include_current') then
    perform public._fail('invalid_mode', 'Choose new emails only, include still-current queued emails, or pause.');
  end if;
  update public.notification_outbox o set status = 'suppressed', error = 'out_of_date_at_release'
   where o.status = 'pending' and o.created_at < v_held_before
     and (public._outbox_obsolete_reason(o.id) is not null or not public._outbox_recipient_active(o.recipient_volunteer_id, o.recipient_person_id));
  get diagnostics n_out = row_count;
  if p_mode = 'new_only' then
    update public.notification_outbox o set status = 'suppressed', error = 'held_before_release'
     where o.status = 'pending' and o.created_at < v_held_before;
    get diagnostics n_held = row_count;
    update public.club_settings set email_released_from = now() where id = 1;
  else
    update public.club_settings set email_released_from = least(now(), coalesce(
      (select min(created_at) from public.notification_outbox where status = 'pending' and created_at < v_held_before), now()))
     where id = 1;
  end if;
  return jsonb_build_object('mode', p_mode, 'suppressed_out_of_date', n_out, 'held_back', n_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- Club settings for the Hub (administrators)
-- ---------------------------------------------------------------------------
create function public.hub_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(public._hub_clean(p ->> 'contact_email', 254)); v_months int := nullif(p ->> 'application_retention_months', '')::int;
begin
  perform public._hub_require('admin');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email', 'Enter a valid club contact email, or leave it blank.'); end if;
  if v_months is not null and (v_months < 1 or v_months > 120) then perform public._fail('invalid_retention', 'Choose between 1 and 120 months, or leave it blank.'); end if;
  update public.club_settings set
    reminder_day_before = coalesce((p ->> 'reminder_day_before')::boolean, reminder_day_before),
    contact_email = v_email,
    applications_open = coalesce((p ->> 'applications_open')::boolean, applications_open),
    application_retention_months = v_months
  where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privacy: anonymise a leaver on request. Keeps event history (as "Former volunteer"), removes their
-- contact details, notes, preferences and availability, ends Hub access, and anonymises any linked
-- applications. Irreversible; audited without the removed details.
-- ---------------------------------------------------------------------------
create function public.hub_anonymise_person(p_person_id uuid) returns void
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

grant execute on function public.hub_save_settings(jsonb), public.hub_anonymise_person(uuid) to authenticated;
revoke execute on function public._hub_payload(text, uuid, jsonb), public._outbox_recipient_active(uuid, uuid) from public, anon, authenticated, service_role;

-- Club contact address for the public pages (under-18 route, privacy notice). Secret key only.
create function public.public_club_contact() returns text
language sql stable security definer set search_path = '' as $$
  select contact_email from public.club_settings where id = 1
$$;
revoke execute on function public.public_club_contact() from public, anon, authenticated;
grant execute on function public.public_club_contact() to service_role;

-- Record that an administrator downloaded an export (what and how many rows; never the content).
create function public.hub_log_export(p_kind text, p_rows int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._hub_require('admin');
  perform public._hub_audit('export', left(p_kind, 40), null, null, jsonb_build_object('rows', p_rows), 'export');
end;
$$;
grant execute on function public.hub_log_export(text, int) to authenticated;
