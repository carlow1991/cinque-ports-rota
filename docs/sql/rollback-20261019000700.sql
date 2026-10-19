-- Rollback for 20261019000700_hub_notifications.sql (Volunteer Hub · Stage 7).
-- Restores the previous email worker and admin email functions (Hub messages are no longer queued),
-- removes the Hub settings, anonymise and export-log functions. Hub messages already in the outbox are
-- marked suppressed first (they can't be sent by the restored worker), then the person-recipient column
-- is dropped. Run in one transaction:  psql -1 -f this-file

update public.notification_outbox set status = 'suppressed', error = 'hub_rollback' where recipient_person_id is not null and status in ('pending', 'sending');
delete from public.notification_outbox where recipient_volunteer_id is null;

drop function if exists public.hub_log_export(text, int);
drop function if exists public.public_club_contact();
drop function if exists public.hub_anonymise_person(uuid);
drop function if exists public.hub_save_settings(jsonb);

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
  end
  from public.notification_outbox o
  left join public.assignments a on o.entity_type = 'assignments' and a.id = o.entity_id
  where o.id = p_id
$$;

create or replace function public.outbox_claim(p_limit int default 25)
returns table (id uuid, kind text, dedupe_key text, payload jsonb, attempt_count int,
               recipient_email text, recipient_name text)
language plpgsql security definer set search_path = '' as $$
declare v_from timestamptz := (select cs.email_released_from from public.club_settings cs where cs.id = 1);
begin
  update public.notification_outbox o set status = 'pending'
   where o.status = 'sending' and o.claimed_at < now() - interval '10 minutes';

  -- Held: hand out nothing until an administrator has started email.
  if v_from is null then return; end if;

  update public.notification_outbox o set status = 'suppressed', error = 'recipient_inactive'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from
     and not exists (select 1 from public.volunteers v where v.id = o.recipient_volunteer_id and v.is_active);

  update public.notification_outbox o set status = 'suppressed', error = 'duty_no_longer_active'
   where o.status = 'pending' and o.send_after <= now() and o.created_at >= v_from and o.kind = 'reminder'
     and not exists (
       select 1 from public.assignments a
       join public.event_shifts s on s.id = a.shift_id
       join public.events e on e.id = s.event_id
       where a.id = o.entity_id and a.status = 'confirmed' and s.status = 'active'
         and e.status = 'published' and s.starts_at > now());

  -- Current-state re-check for every other message.
  update public.notification_outbox o set status = 'suppressed', error = r.reason
    from (select x.id, public._outbox_obsolete_reason(x.id) as reason from public.notification_outbox x
          where x.status = 'pending' and x.send_after <= now() and x.created_at >= v_from) r
   where o.id = r.id and r.reason is not null;

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
    returning o.id, o.kind, o.dedupe_key, o.payload, o.attempt_count, o.recipient_volunteer_id
  )
  select c.id, c.kind, c.dedupe_key, c.payload, c.attempt_count, v.email::text, v.display_name
  from claimed c join public.volunteers v on v.id = c.recipient_volunteer_id;
end;
$$;

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
  -- Held: nothing is queued for sending until an administrator has started email (see below).
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
  return n;
end;
$$;

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
    return 'sent';
  end if;
  v_status := case when p_retryable and v.attempt_count < 5 then 'pending' else 'failed' end;
  update public.notification_outbox
     set status = v_status, error = left(regexp_replace(coalesce(p_error, 'unknown error'), '[^\s@]+@[^\s@]+', '[email]', 'g'), 300),
         send_after = case when v_status = 'pending' then now() + make_interval(mins => power(2, v.attempt_count)::int) else send_after end
   where id = p_id;
  return v_status;
end;
$$;

create or replace function public.outbox_suppress(p_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.notification_outbox set status = 'suppressed', error = left(p_reason, 100)
  where id = p_id and status in ('pending', 'sending')
$$;

create or replace function public.admin_outbox_summary()
returns table (status public.notification_status, kind text, message_count int, last_error text, oldest_due timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then return; end if;
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
declare v_me uuid := public._require_caller(); n int;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can retry emails.'); end if;
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
  if not public.is_admin() then return; end if;
  return query
  select o.kind, count(*)::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is null and v.is_active)::int,
         count(*) filter (where public._outbox_obsolete_reason(o.id) is not null or not v.is_active)::int,
         count(distinct o.recipient_volunteer_id) filter (where public._outbox_obsolete_reason(o.id) is null and v.is_active)::int,
         min(o.created_at)
  from public.notification_outbox o
  join public.volunteers v on v.id = o.recipient_volunteer_id
  where o.status = 'pending' and (v_from is null or o.created_at < v_from)
  group by o.kind
  order by o.kind;
end;
$$;

create or replace function public.admin_set_email_release(p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_from timestamptz := (select email_released_from from public.club_settings where id = 1);
  v_held_before timestamptz := coalesce(v_from, 'infinity'::timestamptz);
  n_out int := 0; n_held int := 0;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can start or pause email.'); end if;
  if p_mode = 'pause' then
    update public.club_settings set email_released_from = null where id = 1;
    return jsonb_build_object('mode', 'pause');
  elsif p_mode not in ('new_only', 'include_current') then
    perform public._fail('invalid_mode', 'Choose new emails only, include still-current queued emails, or pause.');
  end if;

  -- Out-of-date held messages are never sent, whichever option is chosen.
  update public.notification_outbox o set status = 'suppressed', error = 'out_of_date_at_release'
   where o.status = 'pending' and o.created_at < v_held_before
     and (public._outbox_obsolete_reason(o.id) is not null
          or not exists (select 1 from public.volunteers v where v.id = o.recipient_volunteer_id and v.is_active));
  get diagnostics n_out = row_count;

  if p_mode = 'new_only' then
    update public.notification_outbox o set status = 'suppressed', error = 'held_before_release'
     where o.status = 'pending' and o.created_at < v_held_before;
    get diagnostics n_held = row_count;
    update public.club_settings set email_released_from = now() where id = 1;
  else
    -- Keep the remaining held messages eligible: release from the earliest of them (or now).
    update public.club_settings set email_released_from = least(now(), coalesce(
      (select min(created_at) from public.notification_outbox where status = 'pending' and created_at < v_held_before), now()))
     where id = 1;
  end if;
  return jsonb_build_object('mode', p_mode, 'suppressed_out_of_date', n_out, 'held_back', n_held);
end;
$$;

create or replace function public._hub_notify(p_kind text, p_person_id uuid, p_entity_type text, p_entity_id uuid,
                                   p_payload jsonb default '{}'::jsonb, p_key text default null)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  return 'not_sent';
end;
$$;

drop function if exists public._outbox_recipient_active(uuid, uuid);
drop function if exists public._hub_payload(text, uuid, jsonb);
alter table public.notification_outbox drop constraint if exists notification_outbox_has_recipient;
drop index if exists public.notification_outbox_person_idx;
alter table public.notification_outbox drop column if exists recipient_person_id;
alter table public.notification_outbox alter column recipient_volunteer_id set not null;
