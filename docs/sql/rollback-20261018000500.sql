-- Rollback for 20261018000500_email_release_gate.sql. Restores the previous worker functions and
-- removes the release switch. No message rows are deleted. WARNING: after rollback the worker again
-- sends every pending message as soon as EMAIL_SENDING_ENABLED is on.

create or replace function public.outbox_claim(p_limit int default 25)
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

drop function if exists public.admin_set_email_release(text);
drop function if exists public.admin_email_backlog();
drop function if exists public._outbox_obsolete_reason(uuid);
alter table public.club_settings drop column if exists email_released_from;
