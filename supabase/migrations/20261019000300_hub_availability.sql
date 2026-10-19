-- Volunteer Hub · Stage 3: event availability, targeted requests, direct invitations, expected by role.
-- Four separate ideas, never conflated:
--   availability_requests  = "we asked you"            (only these people can be "Not replied")
--   event_availability     = "I could help" (yes/no)   (a reply, NOT an assignment)
--   hub_assignments        = "will you do X?"          (pending until accepted, or recorded by an organiser)
--   expected by role       = derived from team_people  (expected, never "confirmed")
-- ADDITIVE ONLY. Rollback: docs/sql/rollback-20261019000300.sql

create table public.availability_requests (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references public.events (id) on delete cascade,
  person_id               uuid not null references public.people (id) on delete cascade,
  requested_by_person_id  uuid references public.people (id) on delete set null,
  requested_at            timestamptz not null default now(),
  delivery_state          text not null default 'not_sent' check (delivery_state in ('not_sent', 'queued', 'sent', 'failed', 'manual_contact')),
  sent_at                 timestamptz,
  unique (event_id, person_id)
);
create index availability_requests_person_idx on public.availability_requests (person_id);

create table public.event_availability (
  id                     uuid primary key default gen_random_uuid(),
  event_id               uuid not null references public.events (id) on delete cascade,
  person_id              uuid not null references public.people (id) on delete cascade,
  response               text not null check (response in ('yes', 'no')),
  for_full_event         boolean not null default false,
  available_from         timestamptz,
  available_until        timestamptz,
  -- A partial window on an event with no recorded finish can't be checked: an organiser should look.
  needs_admin_check      boolean not null default false,
  response_source        text not null check (response_source in ('self', 'admin_recorded')),
  recorded_by_person_id  uuid references public.people (id) on delete set null,
  responded_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (event_id, person_id),
  constraint event_availability_shape check (
    (response = 'no' and not for_full_event and available_from is null and available_until is null)
    or (response = 'yes' and for_full_event and available_from is null and available_until is null)
    or (response = 'yes' and not for_full_event and available_from is not null and available_until is not null and available_from < available_until)),
  constraint event_availability_recorded_by check (response_source = 'self' or recorded_by_person_id is not null)
);
create index event_availability_person_idx on public.event_availability (person_id);

create table public.hub_assignments (
  id                      uuid primary key default gen_random_uuid(),
  person_id               uuid not null references public.people (id) on delete restrict,
  scope                   text not null check (scope in ('event', 'venue')),
  event_id                uuid references public.events (id) on delete restrict,
  venue_id                uuid references public.venues (id) on delete restrict,
  responsibility_label    text check (responsibility_label is null or char_length(btrim(responsibility_label)) between 1 and 80),
  begins_at               timestamptz,
  ends_at                 timestamptz,
  state                   text not null default 'pending'
                            check (state in ('pending', 'confirmed', 'declined', 'cancelled', 'needs_reconfirmation')),
  invitation_source       text not null check (invitation_source in ('portal', 'email', 'offline')),
  response_source         text check (response_source in ('self', 'admin_recorded')),
  recorded_by_person_id   uuid references public.people (id) on delete set null,
  requested_by_person_id  uuid references public.people (id) on delete set null,
  responded_at            timestamptz,
  cancel_reason           text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  conflict_override_note  text check (conflict_override_note is null or char_length(conflict_override_note) <= 500),
  notes_private           text check (notes_private is null or char_length(notes_private) <= 1000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint hub_assignments_scope_target check (
    (scope = 'event' and event_id is not null and venue_id is null)
    or (scope = 'venue' and venue_id is not null and event_id is null and begins_at is not null and ends_at is not null)),
  constraint hub_assignments_times check (begins_at is null or ends_at is null or begins_at < ends_at),
  constraint hub_assignments_max_length check (begins_at is null or ends_at is null or ends_at - begins_at <= interval '24 hours'),
  -- "Confirmed" is only ever set by the person or recorded by an organiser, with attribution.
  constraint hub_assignments_confirmation_attributed check (
    state not in ('confirmed', 'declined') or response_source is not null),
  constraint hub_assignments_admin_attributed check (response_source is distinct from 'admin_recorded' or recorded_by_person_id is not null)
);
-- One live request per person per event and responsibility (double clicks can't duplicate).
create unique index hub_assignments_event_live_uq on public.hub_assignments (event_id, person_id, coalesce(lower(responsibility_label), ''))
  where scope = 'event' and state in ('pending', 'confirmed', 'needs_reconfirmation');
create index hub_assignments_person_idx on public.hub_assignments (person_id, state);
create index hub_assignments_event_idx on public.hub_assignments (event_id) where event_id is not null;
create index hub_assignments_venue_idx on public.hub_assignments (venue_id, begins_at) where venue_id is not null;

create table public.event_participation_exceptions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  person_id       uuid not null references public.people (id) on delete cascade,
  team_person_id  uuid references public.team_people (id) on delete set null,
  override        text not null check (override in ('not_expected', 'confirmed_by_person', 'confirmed_by_admin')),
  recorded_by     uuid references public.people (id) on delete set null,
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  unique (event_id, person_id)
);

do $$
declare t text;
begin
  foreach t in array array['event_availability', 'hub_assignments']
  loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
  foreach t in array array['availability_requests', 'event_availability', 'hub_assignments', 'event_participation_exceptions']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- RLS: your own rows, or the organisers who manage the event/venue. Writes only via functions.
create policy availability_requests_read on public.availability_requests for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));
create policy event_availability_read on public.event_availability for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));
create policy hub_assignments_read on public.hub_assignments for select to authenticated
  using (person_id = (select public.current_person_id())
         or (scope = 'event' and public.hub_can_manage_event(event_id))
         or (scope = 'venue' and public.hub_can_manage_venue(venue_id)));
create policy event_participation_exceptions_read on public.event_participation_exceptions for select to authenticated
  using (person_id = (select public.current_person_id()) or public.hub_can_manage_event(event_id));

-- ---------------------------------------------------------------------------
-- Notification hook. Stage 3: records the intent only and reports "not_sent" (nothing is emailed).
-- Stage 7 replaces this with the real outbox (explicit actions only, idempotent).
-- ---------------------------------------------------------------------------
create function public._hub_notify(p_kind text, p_person_id uuid, p_entity_type text, p_entity_id uuid,
                                   p_payload jsonb default '{}'::jsonb, p_key text default null)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  return 'not_sent';
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public._hub_event_open(p_event public.events) returns boolean
language sql stable set search_path = '' as $$
  select p_event.status in ('published', 'postponed') and coalesce(p_event.ends_at, p_event.starts_at + interval '6 hours') > now()
$$;

-- ---------------------------------------------------------------------------
-- Availability: explicit request (organiser reviews recipients, then presses Send)
-- ---------------------------------------------------------------------------
create function public.hub_request_availability(p_event_id uuid, p_person_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_pid uuid;
  v_new int := 0;
  v_existing int := 0;
  v_state text;
  v_rid uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if not v_event.volunteers_enabled then perform public._fail('volunteers_not_enabled', 'Turn on “Ask volunteers for availability?” for this event first.'); end if;
  if v_event.status <> 'published' then perform public._fail('event_not_open', 'Publish the event first, so the people you ask can see it.'); end if;
  if not public._hub_event_open(v_event) then perform public._fail('event_not_open', 'This event has finished.'); end if;
  if coalesce(cardinality(p_person_ids), 0) = 0 then perform public._fail('no_recipients', 'Choose at least one person.'); end if;
  if cardinality(p_person_ids) > 200 then perform public._fail('too_many', 'Choose up to 200 people at a time.'); end if;

  foreach v_pid in array (select array_agg(distinct x) from unnest(p_person_ids) x) loop
    if not exists (select 1 from public.people where id = v_pid and lifecycle_status = 'active') then continue; end if;
    insert into public.availability_requests (event_id, person_id, requested_by_person_id)
    values (p_event_id, v_pid, v_me)
    on conflict (event_id, person_id) do nothing
    returning id into v_rid;
    if v_rid is null then
      v_existing := v_existing + 1;
    else
      v_new := v_new + 1;
      v_state := public._hub_notify('availability_request', v_pid, 'availability_requests', v_rid,
                                    jsonb_build_object('event_id', p_event_id), 'availability_request:' || v_rid);
      update public.availability_requests set delivery_state = v_state,
             sent_at = case when v_state in ('queued', 'sent') then now() end where id = v_rid;
    end if;
    v_rid := null;
  end loop;
  return jsonb_build_object('requested', v_new, 'already_asked', v_existing);
end;
$$;

-- Organiser contacted someone another way (phone, in person): mark the request as manual contact.
create function public.hub_mark_request_contacted(p_event_id uuid, p_person_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  insert into public.availability_requests (event_id, person_id, requested_by_person_id, delivery_state)
  values (p_event_id, p_person_id, v_me, 'manual_contact')
  on conflict (event_id, person_id) do update set delivery_state = 'manual_contact';
end;
$$;

-- Validate and save a reply (shared by the person and organisers).
create function public._hub_save_availability(p_event_id uuid, p_person_id uuid, p_response text, p_full boolean,
                                              p_from timestamptz, p_until timestamptz, p_source text, p_recorder uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_check boolean := false;
  v_full boolean := coalesce(p_full, false);
begin
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not v_event.volunteers_enabled then perform public._fail('volunteers_not_enabled', 'This event isn''t asking for volunteers.'); end if;
  if not public._hub_event_open(v_event) then perform public._fail('event_not_open', 'This event isn''t open for replies.'); end if;
  if p_response not in ('yes', 'no') then perform public._fail('invalid_response'); end if;
  if p_response = 'no' then
    v_full := false; p_from := null; p_until := null;
  elsif v_full then
    p_from := null; p_until := null;
  else
    if p_from is null or p_until is null then perform public._fail('times_required', 'Choose from and until times, or “Whole event”.'); end if;
    if p_from >= p_until then perform public._fail('invalid_times', 'The “until” time must be after the “from” time.'); end if;
    if p_until - p_from > interval '24 hours' then perform public._fail('invalid_times', 'That''s longer than a day.'); end if;
    if p_from < v_event.starts_at - interval '3 hours' then perform public._fail('outside_event', 'Those times are well before the event starts.'); end if;
    if v_event.ends_at is not null then
      if p_from >= v_event.ends_at or p_until > v_event.ends_at + interval '3 hours' then
        perform public._fail('outside_event', 'Those times are outside the event.');
      end if;
    else
      -- Finish not recorded: we can't check the end, so an organiser takes a look.
      if p_from > v_event.starts_at + interval '12 hours' then perform public._fail('outside_event', 'Those times are outside the event.'); end if;
      v_check := true;
    end if;
  end if;
  insert into public.event_availability (event_id, person_id, response, for_full_event, available_from, available_until,
                                         needs_admin_check, response_source, recorded_by_person_id, responded_at)
  values (p_event_id, p_person_id, p_response, v_full, p_from, p_until, v_check, p_source, p_recorder, now())
  on conflict (event_id, person_id) do update set
    response = excluded.response, for_full_event = excluded.for_full_event, available_from = excluded.available_from,
    available_until = excluded.available_until, needs_admin_check = excluded.needs_admin_check,
    response_source = excluded.response_source, recorded_by_person_id = excluded.recorded_by_person_id, responded_at = now();
  return jsonb_build_object('response', p_response, 'needs_admin_check', v_check, 'full_event_end_unknown', v_full and v_event.ends_at is null);
end;
$$;

-- The signed-in person answers "Can you help?" for an event that asks for volunteers.
create function public.hub_respond_availability(p_event_id uuid, p_response text, p_full boolean default true,
                                                p_from timestamptz default null, p_until timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and (e.status <> 'draft' or public.hub_can_manage_event(e.id))) then
    perform public._fail('not_found');
  end if;
  return public._hub_save_availability(p_event_id, v_me, p_response, p_full, p_from, p_until, 'self', null);
end;
$$;

-- An organiser records a reply given offline (phone, in person) — labelled "Recorded by organiser".
create function public.hub_record_availability(p_event_id uuid, p_person_id uuid, p_response text, p_full boolean default true,
                                               p_from timestamptz default null, p_until timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  return public._hub_save_availability(p_event_id, p_person_id, p_response, p_full, p_from, p_until, 'admin_recorded', v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct invitations / assignments for one event
-- p_mode: 'request' (pending until they accept) | 'record_confirmed' (organiser records an offline yes)
-- Works for anyone in the directory, including people who don't get routine requests (explicit one-off).
-- ---------------------------------------------------------------------------
create function public.hub_invite_to_help(p_event_id uuid, p_person_id uuid, p_label text default null,
                                          p_begins timestamptz default null, p_ends timestamptz default null,
                                          p_mode text default 'request')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_event public.events%rowtype;
  v_label text := public._hub_clean(p_label, 80);
  v_has_account boolean;
  v_existing public.hub_assignments%rowtype;
  v_id uuid;
  v_delivery text := 'not_sent';
begin
  if p_mode not in ('request', 'record_confirmed') then perform public._fail('invalid_mode'); end if;
  select * into v_event from public.events where id = p_event_id for share;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_event.status in ('cancelled', 'completed') then perform public._fail('event_not_open', 'This event is ' || v_event.status || '.'); end if;
  if not exists (select 1 from public.people where id = p_person_id and lifecycle_status = 'active') then perform public._fail('not_found'); end if;
  if p_begins is not null and p_ends is not null and p_begins >= p_ends then perform public._fail('invalid_times', 'The finish must be after the start.'); end if;
  if p_mode = 'request' and v_event.status = 'draft' then
    perform public._fail('event_not_open', 'Publish the event before asking people, so they can see it.');
  end if;

  select * into v_existing from public.hub_assignments
   where scope = 'event' and event_id = p_event_id and person_id = p_person_id
     and coalesce(lower(responsibility_label), '') = coalesce(lower(v_label), '')
     and state in ('pending', 'confirmed', 'needs_reconfirmation')
   for update;
  if found then
    if p_mode = 'record_confirmed' and v_existing.state <> 'confirmed' then
      update public.hub_assignments set state = 'confirmed', response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
       where id = v_existing.id;
      return jsonb_build_object('assignment_id', v_existing.id, 'status', 'recorded_confirmed', 'existing', true);
    end if;
    return jsonb_build_object('assignment_id', v_existing.id, 'status', 'already_' || v_existing.state, 'existing', true);
  end if;

  select exists (select 1 from public.user_accounts ua where ua.person_id = p_person_id and ua.enabled and ua.auth_user_id is not null)
    into v_has_account;
  insert into public.hub_assignments (person_id, scope, event_id, responsibility_label, begins_at, ends_at, state,
                                      invitation_source, response_source, recorded_by_person_id, requested_by_person_id, responded_at)
  values (p_person_id, 'event', p_event_id, v_label, p_begins, p_ends,
          case when p_mode = 'record_confirmed' then 'confirmed' else 'pending' end,
          case when p_mode = 'record_confirmed' or not v_has_account then 'offline' else 'portal' end,
          case when p_mode = 'record_confirmed' then 'admin_recorded' end,
          case when p_mode = 'record_confirmed' then v_me end, v_me,
          case when p_mode = 'record_confirmed' then now() end)
  returning id into v_id;
  if p_mode = 'request' and v_has_account then
    v_delivery := public._hub_notify('assignment_request', p_person_id, 'hub_assignments', v_id,
                                     jsonb_build_object('event_id', p_event_id), 'assignment_request:' || v_id);
  end if;
  return jsonb_build_object('assignment_id', v_id, 'status', case when p_mode = 'record_confirmed' then 'recorded_confirmed' else 'pending' end,
                            'has_account', v_has_account, 'delivery', v_delivery, 'existing', false);
end;
$$;

-- The person accepts or declines (idempotent: accepting twice stays confirmed once).
create function public.hub_respond_assignment(p_assignment_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_a public.hub_assignments%rowtype;
  v_new text := case when p_accept then 'confirmed' else 'declined' end;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found or v_a.person_id <> v_me then perform public._fail('not_found'); end if;
  if v_a.state = v_new then return v_new; end if;
  if v_a.state not in ('pending', 'needs_reconfirmation') then
    perform public._fail('invalid_transition', 'This request has already been ' || v_a.state || '.');
  end if;
  update public.hub_assignments set state = v_new, response_source = 'self', recorded_by_person_id = null, responded_at = now()
   where id = p_assignment_id;
  perform public._hub_notify('assignment_' || v_new, v_a.requested_by_person_id, 'hub_assignments', p_assignment_id,
                             jsonb_build_object('person_id', v_me), 'assignment_response:' || p_assignment_id || ':' || v_new || ':' || extract(epoch from now())::bigint);
  return v_new;
end;
$$;

-- The person can step back from something they had confirmed.
create function public.hub_withdraw_assignment(p_assignment_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('member');
  v_a public.hub_assignments%rowtype;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found or v_a.person_id <> v_me then perform public._fail('not_found'); end if;
  if v_a.state = 'cancelled' then return; end if;
  if v_a.state not in ('confirmed', 'needs_reconfirmation', 'pending') then perform public._fail('invalid_transition'); end if;
  update public.hub_assignments set state = 'cancelled', cancel_reason = coalesce(public._hub_clean(p_reason, 500), 'Withdrawn by the volunteer'),
         response_source = 'self', responded_at = now() where id = p_assignment_id;
  perform public._hub_notify('assignment_withdrawn', v_a.requested_by_person_id, 'hub_assignments', p_assignment_id, '{}'::jsonb,
                             'assignment_withdrawn:' || p_assignment_id);
end;
$$;

create function public._hub_can_manage_assignment(p_a public.hub_assignments) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_a.scope when 'event' then public.hub_can_manage_event(p_a.event_id) else public.hub_can_manage_venue(p_a.venue_id) end
$$;

-- Organiser records the person's answer given offline ("Confirmed by organiser" / declined).
create function public.hub_record_assignment_response(p_assignment_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
  v_new text := case when p_accept then 'confirmed' else 'declined' end;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public._hub_can_manage_assignment(v_a) then perform public._fail('not_authorised'); end if;
  if v_a.state = v_new then return v_new; end if;
  if v_a.state not in ('pending', 'needs_reconfirmation') then perform public._fail('invalid_transition', 'This is already ' || v_a.state || '.'); end if;
  update public.hub_assignments set state = v_new, response_source = 'admin_recorded', recorded_by_person_id = v_me, responded_at = now()
   where id = p_assignment_id;
  return v_new;
end;
$$;

create function public.hub_cancel_assignment(p_assignment_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_a public.hub_assignments%rowtype;
begin
  select * into v_a from public.hub_assignments where id = p_assignment_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public._hub_can_manage_assignment(v_a) then perform public._fail('not_authorised'); end if;
  if v_a.state = 'cancelled' then return; end if;
  if v_a.state = 'declined' then perform public._fail('invalid_transition', 'They already declined.'); end if;
  update public.hub_assignments set state = 'cancelled', cancel_reason = coalesce(public._hub_clean(p_reason, 500), 'Cancelled by an organiser'),
         recorded_by_person_id = v_me where id = p_assignment_id;
  if v_a.state in ('confirmed', 'needs_reconfirmation', 'pending') then
    perform public._hub_notify('assignment_cancelled', v_a.person_id, 'hub_assignments', p_assignment_id, '{}'::jsonb,
                               'assignment_cancelled:' || p_assignment_id);
  end if;
end;
$$;

-- Ask again after an organiser-led change (resets a declined/cancelled person? no — a new request is a new row).

-- ---------------------------------------------------------------------------
-- Expected by role: per-event override (e.g. manager away this week). Never edits the team role.
-- p_override: 'not_expected' | 'confirmed_by_admin' | null (clear)
-- ---------------------------------------------------------------------------
create function public.hub_set_expected_override(p_event_id uuid, p_person_id uuid, p_override text, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('manager');
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if p_override is null then
    delete from public.event_participation_exceptions where event_id = p_event_id and person_id = p_person_id;
    return;
  end if;
  if p_override not in ('not_expected', 'confirmed_by_admin') then perform public._fail('invalid_override'); end if;
  insert into public.event_participation_exceptions (event_id, person_id, override, recorded_by, note,
    team_person_id)
  values (p_event_id, p_person_id, p_override, v_me, public._hub_clean(p_note, 300),
    (select tp.id from public.team_people tp join public.events e on e.team_id = tp.team_id
      where e.id = p_event_id and tp.person_id = p_person_id order by tp.active_from desc limit 1))
  on conflict (event_id, person_id) do update set override = excluded.override, recorded_by = v_me, note = excluded.note, created_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Material event change → confirmed people must reconfirm; cancelled event → open requests closed.
-- (Replaces the Stage 2 no-op hooks.)
-- ---------------------------------------------------------------------------
create or replace function public._hub_after_event_change(p_event_id uuid, p_material boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if not p_material then return; end if;
  for r in update public.hub_assignments set state = 'needs_reconfirmation'
            where scope = 'event' and event_id = p_event_id and state = 'confirmed'
            returning id, person_id
  loop
    perform public._hub_notify('assignment_reconfirm', r.person_id, 'hub_assignments', r.id,
                               jsonb_build_object('event_id', p_event_id), 'assignment_reconfirm:' || r.id || ':' || extract(epoch from now())::bigint);
  end loop;
end;
$$;

create or replace function public._hub_after_event_cancel(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in update public.hub_assignments set state = 'cancelled', cancel_reason = 'The event was cancelled'
            where scope = 'event' and event_id = p_event_id and state in ('pending', 'confirmed', 'needs_reconfirmation')
            returning id, person_id
  loop
    perform public._hub_notify('event_cancelled', r.person_id, 'hub_assignments', r.id,
                               jsonb_build_object('event_id', p_event_id), 'event_cancelled:' || r.id);
  end loop;
end;
$$;

-- hub_update_event now also reports how many people need to reconfirm.
create or replace function public.hub_update_event(p_event_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._hub_require('manager');
  v_old public.events%rowtype;
  f jsonb;
  v_material boolean;
  v_before int;
begin
  select * into v_old from public.events where id = p_event_id for update;
  if not found then perform public._fail('not_found'); end if;
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  if v_old.status in ('cancelled', 'completed') then perform public._fail('invalid_transition', 'Cancelled or completed events can''t be edited. Copy it as a new event instead.'); end if;
  f := public._hub_event_fields(p, v_old.venue_id);
  if not (public.hub_is_admin() or public.hub_can_manage_venue((f ->> 'venue_id')::uuid) or public.hub_can_manage_team((f ->> 'team_id')::uuid)) then
    perform public._fail('not_authorised', 'You can only move events to your venues or teams.');
  end if;
  v_material := v_old.starts_at is distinct from (f ->> 'starts_at')::timestamptz
             or v_old.ends_at is distinct from (f ->> 'ends_at')::timestamptz
             or v_old.venue_id is distinct from (f ->> 'venue_id')::uuid
             or v_old.external_location_text is distinct from (f ->> 'external_location_text');
  update public.events set
    title = f ->> 'title', category = f ->> 'category', event_type = public._hub_event_type(f ->> 'category'),
    venue_id = (f ->> 'venue_id')::uuid, external_location_text = f ->> 'external_location_text',
    starts_at = (f ->> 'starts_at')::timestamptz, ends_at = (f ->> 'ends_at')::timestamptz, kickoff_at = (f ->> 'kickoff_at')::timestamptz,
    team_id = (f ->> 'team_id')::uuid, volunteers_enabled = (f ->> 'volunteers_enabled')::boolean, visibility = f ->> 'visibility',
    description = f ->> 'description', opponent = f ->> 'opponent', competition = f ->> 'competition',
    organiser_person_id = coalesce((f ->> 'organiser_person_id')::uuid, organiser_person_id),
    last_changed_by_person_id = v_me
  where id = p_event_id;
  select count(*) into v_before from public.hub_assignments where scope = 'event' and event_id = p_event_id and state = 'confirmed';
  perform public._hub_after_event_change(p_event_id, v_material);
  return jsonb_build_object('material', v_material, 'reconfirm', case when v_material then v_before else 0 end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Everyone involved with one event. Members get sections 1–4 (no contact details); organisers also
-- get requests, non-replies, declines and contact details.
create function public.hub_event_involvement(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.current_person_id();
  v_mgr boolean;
  v_event public.events%rowtype;
  v_day date;
begin
  if v_me is null then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or (v_event.status = 'draft' and not public.hub_can_manage_event(p_event_id)) then perform public._fail('not_found'); end if;
  v_mgr := public.hub_can_manage_event(p_event_id);
  v_day := (v_event.starts_at at time zone 'Europe/London')::date;
  return jsonb_build_object(
    'can_manage', v_mgr,
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'person_id', a.person_id, 'name', coalesce(p.display_name, p.full_name), 'label', a.responsibility_label,
        'begins_at', a.begins_at, 'ends_at', a.ends_at, 'state', a.state, 'response_source', a.response_source,
        'invitation_source', a.invitation_source, 'responded_at', a.responded_at, 'cancel_reason', case when v_mgr then a.cancel_reason end,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = a.recorded_by_person_id) end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by a.state, a.begins_at nulls first)
      from public.hub_assignments a join public.people p on p.id = a.person_id
      where a.scope = 'event' and a.event_id = p_event_id
        and (v_mgr or a.state in ('confirmed', 'needs_reconfirmation') or a.person_id = v_me)), '[]'::jsonb),
    'expected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', tp.person_id, 'name', coalesce(p.display_name, p.full_name), 'role', tp.role_label,
        'override', x.override, 'override_note', case when v_mgr then x.note end,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by tp.role_label, p.full_name)
      from public.team_people tp join public.people p on p.id = tp.person_id
      left join public.event_participation_exceptions x on x.event_id = p_event_id and x.person_id = tp.person_id
      where v_event.team_id is not null and tp.team_id = v_event.team_id and tp.is_expected_by_default
        and p.lifecycle_status = 'active' and tp.active_from <= v_day and (tp.active_to is null or tp.active_to >= v_day)
        and (v_mgr or x.override is distinct from 'not_expected')), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', ea.person_id, 'name', coalesce(p.display_name, p.full_name), 'response', ea.response,
        'for_full_event', ea.for_full_event, 'available_from', ea.available_from, 'available_until', ea.available_until,
        'needs_admin_check', case when v_mgr then ea.needs_admin_check end, 'response_source', ea.response_source,
        'recorded_by', case when v_mgr then (select coalesce(r.display_name, r.full_name) from public.people r where r.id = ea.recorded_by_person_id) end,
        'responded_at', ea.responded_at,
        'email', case when v_mgr then p.email_normalized::text end, 'phone', case when v_mgr then p.phone_normalized end)
        order by ea.responded_at)
      from public.event_availability ea join public.people p on p.id = ea.person_id
      where ea.event_id = p_event_id and (v_mgr or ea.response = 'yes' or ea.person_id = v_me)), '[]'::jsonb),
    'requests', case when v_mgr then coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', r.person_id, 'name', coalesce(p.display_name, p.full_name), 'requested_at', r.requested_at,
        'delivery_state', r.delivery_state, 'replied', exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id),
        'email', p.email_normalized::text, 'phone', p.phone_normalized) order by p.full_name)
      from public.availability_requests r join public.people p on p.id = r.person_id
      where r.event_id = p_event_id), '[]'::jsonb) else '[]'::jsonb end,
    'my_request', exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = v_me));
end;
$$;

-- Recipient picker for "Request availability": everyone active and over 18, with the routine
-- preference used ONLY to pre-tick. Nothing is sent from here.
create function public.hub_request_candidates(p_event_id uuid) returns table (
  person_id uuid, name text, suggested boolean, reason text, already_asked boolean, replied text, has_account boolean, has_email boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_event public.events%rowtype;
begin
  if not public.hub_can_manage_event(p_event_id) then perform public._fail('not_authorised'); end if;
  select * into v_event from public.events where id = p_event_id;
  return query
  select p.id, coalesce(p.display_name, p.full_name),
    p.routine_requests_enabled,
    case when p.routine_requests_enabled then 'Usually asked' else null end,
    exists (select 1 from public.availability_requests r where r.event_id = p_event_id and r.person_id = p.id),
    (select ea.response from public.event_availability ea where ea.event_id = p_event_id and ea.person_id = p.id),
    exists (select 1 from public.user_accounts ua where ua.person_id = p.id and ua.enabled and ua.auth_user_id is not null),
    p.email_normalized is not null
  from public.people p
  where p.lifecycle_status = 'active' and not p.is_under_18
  order by p.routine_requests_enabled desc, lower(coalesce(p.display_name, p.full_name));
end;
$$;

-- People an organiser can invite or record for (picker), with contact details for offline contact.
create function public.hub_people_picker() returns table (person_id uuid, name text, has_account boolean, email text, phone text, routine boolean)
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

-- The signed-in person's Home: what needs a reply, what they've agreed to, what's on.
create function public.hub_my_home() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public._hub_require('member');
begin
  return jsonb_build_object(
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'state', a.state, 'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at,
        'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title, 'event_starts_at', e.starts_at, 'event_ends_at', e.ends_at,
        'venue_id', coalesce(a.venue_id, e.venue_id), 'external_location_text', e.external_location_text) order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a left join public.events e on e.id = a.event_id
      where a.person_id = v_me and a.state in ('pending', 'needs_reconfirmation')
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours', a.begins_at + interval '6 hours') > now()
        and (e.id is null or e.status not in ('cancelled', 'draft'))), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
        'kickoff_at', e.kickoff_at, 'venue_id', e.venue_id, 'external_location_text', e.external_location_text) order by e.starts_at)
      from public.availability_requests r join public.events e on e.id = r.event_id
      where r.person_id = v_me and e.status = 'published' and e.volunteers_enabled and public._hub_event_open(e)
        and not exists (select 1 from public.event_availability ea where ea.event_id = e.id and ea.person_id = v_me)), '[]'::jsonb),
    'commitments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.responsibility_label, 'begins_at', a.begins_at, 'ends_at', a.ends_at,
        'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title, 'event_starts_at', e.starts_at, 'event_ends_at', e.ends_at,
        'venue_id', coalesce(a.venue_id, e.venue_id), 'external_location_text', e.external_location_text, 'response_source', a.response_source)
        order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a left join public.events e on e.id = a.event_id
      where a.person_id = v_me and a.state = 'confirmed'
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours') > now()
        and (e.id is null or e.status not in ('cancelled', 'draft'))), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', ea.event_id, 'response', ea.response))
      from public.event_availability ea join public.events e on e.id = ea.event_id
      where ea.person_id = v_me and e.starts_at > now() - interval '1 day'), '[]'::jsonb));
end;
$$;

-- Organiser "Requests" view: invitations awaiting an answer and availability not yet replied.
create function public.hub_open_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._hub_require('manager');
  return jsonb_build_object(
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'state', a.state, 'name', coalesce(p.display_name, p.full_name), 'person_id', a.person_id,
        'label', a.responsibility_label, 'scope', a.scope, 'event_id', a.event_id, 'event_title', e.title,
        'starts_at', coalesce(a.begins_at, e.starts_at), 'venue_id', coalesce(a.venue_id, e.venue_id), 'invitation_source', a.invitation_source,
        'created_at', a.created_at, 'phone', p.phone_normalized, 'email', p.email_normalized::text) order by coalesce(a.begins_at, e.starts_at))
      from public.hub_assignments a join public.people p on p.id = a.person_id left join public.events e on e.id = a.event_id
      where a.state in ('pending', 'needs_reconfirmation')
        and coalesce(a.ends_at, e.ends_at, e.starts_at + interval '6 hours', a.begins_at + interval '6 hours') > now()
        and public._hub_can_manage_assignment(a)), '[]'::jsonb),
    'unanswered', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at, 'asked', x.asked, 'unanswered', x.unanswered)
        order by e.starts_at)
      from (select r.event_id, count(*) asked,
                   count(*) filter (where not exists (select 1 from public.event_availability ea where ea.event_id = r.event_id and ea.person_id = r.person_id)) unanswered
              from public.availability_requests r group by r.event_id) x
      join public.events e on e.id = x.event_id
      where x.unanswered > 0 and e.status = 'published' and public._hub_event_open(e) and public.hub_can_manage_event(e.id)), '[]'::jsonb));
end;
$$;

grant execute on function
  public.hub_request_availability(uuid, uuid[]), public.hub_mark_request_contacted(uuid, uuid),
  public.hub_respond_availability(uuid, text, boolean, timestamptz, timestamptz),
  public.hub_record_availability(uuid, uuid, text, boolean, timestamptz, timestamptz),
  public.hub_invite_to_help(uuid, uuid, text, timestamptz, timestamptz, text),
  public.hub_respond_assignment(uuid, boolean), public.hub_withdraw_assignment(uuid, text),
  public.hub_record_assignment_response(uuid, boolean), public.hub_cancel_assignment(uuid, text),
  public.hub_set_expected_override(uuid, uuid, text, text),
  public.hub_event_involvement(uuid), public.hub_request_candidates(uuid), public.hub_people_picker(),
  public.hub_my_home(), public.hub_open_requests()
to authenticated;
