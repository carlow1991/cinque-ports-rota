-- Phase 6: email outbox worker.
-- The worker (server only, secret key → role service_role) calls ONLY these functions:
--   outbox_enqueue_reminders()  day-before reminders, worked out in the club's time zone
--   outbox_claim(n)             hand out due messages once (SKIP LOCKED), re-checking at send time
--   outbox_complete(...)        mark sent, or schedule a retry with exponential backoff
--   outbox_suppress(id, why)    never send (e.g. staging address not on the allow-list)
-- Admins (signed in) get a redacted summary and a "retry failed" button. App users can never
-- read the outbox or call the worker functions.

alter table public.notification_outbox
  add column claimed_at timestamptz,
  add column last_attempt_at timestamptz,
  add column provider_message_id text;

create index notification_outbox_sending_idx on public.notification_outbox (claimed_at) where status = 'sending';

-- Recipient-safe payload, now including the reason for a cancellation/postponement/removal
-- (it concerns the recipient's own duty). Still nothing about any other person.
create or replace function public._assignment_payload(p_assignment_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'assignment_id', a.id, 'status', a.status, 'event_id', e.id, 'event_title', e.title,
    'venue', v.name, 'duty', dt.name, 'shift_starts_at', s.starts_at, 'shift_ends_at', s.ends_at,
    'event_status_reason', e.status_reason, 'removal_reason', a.removal_reason)
  from public.assignments a
  join public.event_shifts s on s.id = a.shift_id
  join public.events e on e.id = s.event_id
  join public.venues v on v.id = e.venue_id
  join public.duty_types dt on dt.id = s.duty_type_id
  where a.id = p_assignment_id
$$;

-- Day-before reminders. "Tomorrow" is the club's local date (Europe/London), so BST/GMT changes
-- are handled; each reminder is due at 18:00 local time the day before (or straight away if that
-- has passed). The dedupe key includes the local date, so a moved duty gets a fresh reminder and
-- re-running never duplicates.
create function public.outbox_enqueue_reminders(p_now timestamptz default now()) returns integer
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

-- Hand out up to p_limit due messages, each to exactly one worker. Before handing out:
--  * messages stuck in 'sending' for 10+ minutes (crashed worker) go back to the queue;
--  * messages that must no longer be sent are suppressed: recipient suspended, or a reminder
--    whose duty is no longer confirmed / active / published / still in the future.
create function public.outbox_claim(p_limit int default 25)
returns table (id uuid, kind text, dedupe_key text, payload jsonb, attempt_count int,
               recipient_email text, recipient_name text)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_outbox o set status = 'pending'
   where o.status = 'sending' and o.claimed_at < now() - interval '10 minutes';

  update public.notification_outbox o set status = 'suppressed', error = 'recipient_inactive'
   where o.status = 'pending' and o.send_after <= now()
     and not exists (select 1 from public.volunteers v where v.id = o.recipient_volunteer_id and v.is_active);

  update public.notification_outbox o set status = 'suppressed', error = 'duty_no_longer_active'
   where o.status = 'pending' and o.send_after <= now() and o.kind = 'reminder'
     and not exists (
       select 1 from public.assignments a
       join public.event_shifts s on s.id = a.shift_id
       join public.events e on e.id = s.event_id
       where a.id = o.entity_id and a.status = 'confirmed' and s.status = 'active'
         and e.status = 'published' and s.starts_at > now());

  return query
  with due as (
    select o.id from public.notification_outbox o
    where o.status = 'pending' and o.send_after <= now()
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

-- Record the result. Failures retry after 2, 4, 8, 16 minutes; after 5 attempts (or a permanent
-- error) the message is marked failed for an admin to look at. Errors are stored without addresses.
create function public.outbox_complete(p_id uuid, p_ok boolean, p_error text default null,
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

create function public.outbox_suppress(p_id uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  update public.notification_outbox set status = 'suppressed', error = left(p_reason, 100)
  where id = p_id and status in ('pending', 'sending')
$$;

-- Admin view: counts by status and recent problems. No addresses, names or message content.
create function public.admin_outbox_summary()
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

create function public.admin_retry_failed_emails() returns integer
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

revoke execute on function public.outbox_enqueue_reminders(timestamptz), public.outbox_claim(int),
  public.outbox_complete(uuid, boolean, text, text, boolean), public.outbox_suppress(uuid, text)
  from public, anon, authenticated;
grant execute on function public.outbox_enqueue_reminders(timestamptz), public.outbox_claim(int),
  public.outbox_complete(uuid, boolean, text, text, boolean), public.outbox_suppress(uuid, text)
  to service_role;
grant execute on function public.admin_outbox_summary(), public.admin_retry_failed_emails() to authenticated;
-- The worker role needs the tables these SECURITY DEFINER functions touch only through them.
grant usage on schema public to service_role;
