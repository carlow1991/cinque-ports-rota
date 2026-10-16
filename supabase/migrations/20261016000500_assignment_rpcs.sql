-- Phase 2 (4/5): narrowly scoped, atomic RPCs. Each one:
--   * derives the caller from auth.uid() (inactive accounts resolve to NULL → refused);
--   * checks object-level permission (own record / venue scope / admin);
--   * locks in a fixed order (volunteer row FIRST, then shift row) and re-checks
--     eligibility, capacity and overlaps INSIDE the transaction;
--   * writes the change, its audit row (trigger) and its outbox row in the same transaction.
-- Errors are raised with errcode P0001 and a stable machine-readable message code.

alter table public.events add column status_reason text check (status_reason is null or char_length(status_reason) <= 500);
create index audit_log_actor_idx on public.audit_log (actor_volunteer_id, created_at);

-- ---------------------------------------------------------------------------
-- Internal helpers (no EXECUTE grant to clients)
-- ---------------------------------------------------------------------------
create function public._fail(p_code text, p_detail text default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, p_code);
end;
$$;

create function public._require_caller() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := public.current_volunteer_id();
begin
  if v is null then perform public._fail('not_authorised', 'Sign in with an active volunteer account.'); end if;
  return v;
end;
$$;

create function public._enqueue(
  p_recipient uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_dedupe text,
  p_payload jsonb, p_is_demo boolean, p_send_after timestamptz default now()
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notification_outbox
    (recipient_volunteer_id, kind, entity_type, entity_id, dedupe_key, payload, send_after, status)
  values (p_recipient, p_kind, p_entity_type, p_entity_id, p_dedupe,
          p_payload || jsonb_build_object('demo', p_is_demo), p_send_after,
          case when p_is_demo then 'suppressed'::public.notification_status else 'pending' end)
  on conflict (dedupe_key) do nothing
$$;

-- Minimal, recipient-safe payload: only the recipient's own duty. Never other people's details.
create function public._assignment_payload(p_assignment_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'assignment_id', a.id, 'status', a.status, 'event_id', e.id, 'event_title', e.title,
    'venue', v.name, 'duty', dt.name, 'shift_starts_at', s.starts_at, 'shift_ends_at', s.ends_at)
  from public.assignments a
  join public.event_shifts s on s.id = a.shift_id
  join public.events e on e.id = s.event_id
  join public.venues v on v.id = e.venue_id
  join public.duty_types dt on dt.id = s.duty_type_id
  where a.id = p_assignment_id
$$;

create function public._notify_assignment(p_assignment_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select a.volunteer_id, a.status_changed_at, e.is_demo into r
  from public.assignments a join public.event_shifts s on s.id = a.shift_id join public.events e on e.id = s.event_id
  where a.id = p_assignment_id;
  perform public._enqueue(r.volunteer_id, p_kind, 'assignments', p_assignment_id,
    format('%s:%s:%s', p_kind, p_assignment_id, extract(epoch from r.status_changed_at)),
    public._assignment_payload(p_assignment_id), r.is_demo);
end;
$$;

-- Alert every active admin plus the venue's coordinators.
create function public._notify_managers(p_venue_id uuid, p_kind text, p_entity_type text, p_entity_id uuid,
                                        p_payload jsonb, p_is_demo boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_stamp text := extract(epoch from clock_timestamp())::text;
begin
  for r in
    select v.id from public.volunteers v where v.is_active and v.role = 'admin'
    union
    select v.id from public.volunteers v join public.coordinator_venues cv on cv.volunteer_id = v.id
    where v.is_active and v.role = 'coordinator' and cv.venue_id = p_venue_id
  loop
    perform public._enqueue(r.id, p_kind, p_entity_type, p_entity_id,
      format('%s:%s:%s:%s', p_kind, p_entity_id, r.id, v_stamp), p_payload, p_is_demo);
  end loop;
end;
$$;

create function public._shift_counts(p_shift_id uuid, out confirmed int, out pending int, out invited int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where status = 'confirmed')::int,
         count(*) filter (where status = 'pending_approval')::int,
         count(*) filter (where status = 'invited')::int
  from public.assignments where shift_id = p_shift_id
$$;

-- Does the volunteer already hold a confirmed/pending commitment overlapping this shift (any venue)?
create function public._has_overlap(p_volunteer_id uuid, p_shift_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.event_shifts t
    join public.assignments a on a.volunteer_id = p_volunteer_id
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    where t.id = p_shift_id
      and s.id <> t.id
      and a.status in ('confirmed', 'pending_approval')
      and s.status = 'active'
      and e.status not in ('cancelled')
      and s.starts_at < t.ends_at and t.starts_at < s.ends_at)
$$;

-- Re-checks shared by sign-up, acceptance and approval. Caller must already hold the locks.
create function public._check_can_commit(p_volunteer_id uuid, p_shift public.event_shifts, p_exclude_assignment uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_missing text[];
  c record;
begin
  select * into v_event from public.events where id = p_shift.event_id;
  if v_event.status <> 'published' then
    perform public._fail('event_not_open', 'This event is not open for volunteers.');
  end if;
  if p_shift.status <> 'active' then
    perform public._fail('shift_not_open', 'This duty has been cancelled.');
  end if;
  if p_shift.starts_at <= now() then
    perform public._fail('shift_started', 'This duty has already started.');
  end if;
  v_missing := public.missing_authorisations(p_volunteer_id, p_shift.id, p_shift.ends_at);
  if cardinality(v_missing) > 0 or not exists (select 1 from public.volunteers where id = p_volunteer_id and is_active) then
    perform public._fail('not_eligible', 'This duty needs a club authorisation: ' || array_to_string(v_missing, ', '));
  end if;
  select confirmed, pending into c from public._shift_counts(p_shift.id);
  -- The assignment being confirmed may itself already hold a pending place.
  if exists (select 1 from public.assignments where id = p_exclude_assignment and status = 'pending_approval') then
    c.pending := c.pending - 1;
  end if;
  if c.confirmed + c.pending >= p_shift.required_count then
    perform public._fail('shift_full', 'Shift now full; please contact the organiser.');
  end if;
  if public._has_overlap(p_volunteer_id, p_shift.id) then
    perform public._fail('overlap', 'You already have a duty at an overlapping time.');
  end if;
end;
$$;

create function public._assert_manager_of_shift(p_shift_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage_shift(p_shift_id) then
    perform public._fail('not_authorised', 'You do not manage this venue.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Volunteer actions
-- ---------------------------------------------------------------------------
create function public.self_signup(p_shift_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_shift public.event_shifts%rowtype;
  v_existing public.assignments%rowtype;
  v_status public.assignment_status;
  v_id uuid;
begin
  perform 1 from public.volunteers where id = v_me for update;                 -- lock 1: volunteer
  if (select count(*) from public.audit_log
      where actor_volunteer_id = v_me and entity_type = 'assignments' and created_at > now() - interval '1 minute') >= 20 then
    perform public._fail('rate_limited', 'Too many changes in a short time. Please wait a minute.');
  end if;
  select * into v_shift from public.event_shifts where id = p_shift_id for update; -- lock 2: shift
  if not found or not public.can_view_shift(p_shift_id) then
    perform public._fail('not_found', 'Duty not found.');
  end if;
  if not v_shift.signup_enabled then
    perform public._fail('signup_disabled', 'This duty is filled by the organiser, not by sign-up.');
  end if;

  select * into v_existing from public.assignments where shift_id = p_shift_id and volunteer_id = v_me;
  if found and v_existing.status in ('confirmed', 'pending_approval') then
    perform public._fail('already_assigned', 'You are already down for this duty.');
  elsif found and v_existing.status = 'invited' then
    perform public._fail('already_invited', 'You have been invited to this duty; accept the invitation instead.');
  elsif found and v_existing.status = 'cancelled' then
    perform public._fail('shift_not_open', 'This duty has been cancelled.');
  end if;

  perform public._check_can_commit(v_me, v_shift, null);
  v_status := case when v_shift.approval_required then 'pending_approval' else 'confirmed' end;

  if v_existing.id is not null then
    update public.assignments
       set status = v_status, source = 'self_signup', assigned_by = null, responded_at = now(), removal_reason = null
     where id = v_existing.id returning id into v_id;
  else
    insert into public.assignments (shift_id, volunteer_id, status, source, responded_at)
    values (p_shift_id, v_me, v_status, 'self_signup', now()) returning id into v_id;
  end if;

  perform public._notify_assignment(v_id, case when v_status = 'confirmed' then 'signup_confirmed' else 'signup_pending' end);
  return jsonb_build_object('assignment_id', v_id, 'status', v_status);
end;
$$;

create function public.accept_invitation(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
  v_shift public.event_shifts%rowtype;
  v_status public.assignment_status;
begin
  perform 1 from public.volunteers where id = v_me for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found or v_a.volunteer_id <> v_me then perform public._fail('not_found', 'Invitation not found.'); end if;
  select * into v_shift from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;   -- re-read under the shift lock
  if v_a.status <> 'invited' then
    perform public._fail('invalid_transition', 'This invitation is no longer open.');
  end if;
  perform public._check_can_commit(v_me, v_shift, v_a.id);
  -- Re-run approval logic: an approval-required duty NEVER goes straight to confirmed.
  v_status := case when v_shift.approval_required then 'pending_approval' else 'confirmed' end;
  update public.assignments set status = v_status, responded_at = now() where id = v_a.id;
  perform public._notify_assignment(v_a.id, case when v_status = 'confirmed' then 'invitation_accepted' else 'signup_pending' end);
  return jsonb_build_object('assignment_id', v_a.id, 'status', v_status);
end;
$$;

create function public.decline_invitation(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
begin
  perform 1 from public.volunteers where id = v_me for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found or v_a.volunteer_id <> v_me then perform public._fail('not_found', 'Invitation not found.'); end if;
  perform 1 from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if v_a.status <> 'invited' then perform public._fail('invalid_transition', 'This invitation is no longer open.'); end if;
  update public.assignments set status = 'declined', responded_at = now() where id = v_a.id;
  return jsonb_build_object('assignment_id', v_a.id, 'status', 'declined');
end;
$$;

-- Before the cutoff a volunteer may withdraw; inside it they must request cancellation (cover is kept).
create function public.withdraw_assignment(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
  v_shift public.event_shifts%rowtype;
  v_cutoff int := (select withdrawal_cutoff_hours from public.club_settings where id = 1);
begin
  perform 1 from public.volunteers where id = v_me for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found or v_a.volunteer_id <> v_me then perform public._fail('not_found', 'Duty not found.'); end if;
  select * into v_shift from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if v_a.status not in ('confirmed', 'pending_approval') then
    perform public._fail('invalid_transition', 'You are not currently down for this duty.');
  end if;
  if v_shift.starts_at - make_interval(hours => coalesce(v_cutoff, 24)) <= now() then
    perform public._fail('inside_cutoff', 'It is too close to the duty to withdraw online; request a cancellation instead.');
  end if;
  update public.assignments set status = 'withdrawn', responded_at = now() where id = v_a.id;
  perform public._notify_assignment(v_a.id, 'withdrawal_confirmed');
  return jsonb_build_object('assignment_id', v_a.id, 'status', 'withdrawn');
end;
$$;

create function public.request_cancellation(p_assignment_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
  v_shift public.event_shifts%rowtype;
  v_event public.events%rowtype;
  v_req uuid;
begin
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found or v_a.volunteer_id <> v_me then perform public._fail('not_found', 'Duty not found.'); end if;
  if v_a.status not in ('confirmed', 'pending_approval') then
    perform public._fail('invalid_transition', 'You are not currently down for this duty.');
  end if;
  if exists (select 1 from public.cancellation_requests where assignment_id = v_a.id and status = 'pending') then
    perform public._fail('already_requested', 'You have already asked to cancel this duty.');
  end if;
  insert into public.cancellation_requests (assignment_id, volunteer_id, reason)
  values (v_a.id, v_me, nullif(btrim(left(p_reason, 500)), '')) returning id into v_req;
  select * into v_shift from public.event_shifts where id = v_a.shift_id;
  select * into v_event from public.events where id = v_shift.event_id;
  perform public._notify_managers(v_event.venue_id, 'cancellation_requested', 'cancellation_requests', v_req,
    public._assignment_payload(v_a.id) - 'assignment_id', v_event.is_demo);
  return jsonb_build_object('request_id', v_req, 'status', 'pending');
end;
$$;

-- ---------------------------------------------------------------------------
-- Organiser actions (venue-scoped)
-- ---------------------------------------------------------------------------
create function public.allocate_volunteer(p_shift_id uuid, p_volunteer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_shift public.event_shifts%rowtype;
  v_event public.events%rowtype;
  v_existing public.assignments%rowtype;
  v_missing text[];
  v_id uuid;
begin
  perform public._assert_manager_of_shift(p_shift_id);
  perform 1 from public.volunteers where id = p_volunteer_id and is_active for update;   -- lock target volunteer
  if not found then perform public._fail('not_found', 'Volunteer not found or not active.'); end if;
  select * into v_shift from public.event_shifts where id = p_shift_id for update;
  select * into v_event from public.events where id = v_shift.event_id;
  if v_event.status not in ('published', 'postponed') or v_shift.status <> 'active' then
    perform public._fail('event_not_open', 'Publish the event before inviting volunteers.');
  end if;
  v_missing := public.missing_authorisations(p_volunteer_id, p_shift_id, v_shift.ends_at);
  if cardinality(v_missing) > 0 then
    perform public._fail('not_eligible', 'This volunteer needs a club authorisation: ' || array_to_string(v_missing, ', '));
  end if;
  select * into v_existing from public.assignments where shift_id = p_shift_id and volunteer_id = p_volunteer_id;
  if found and v_existing.status in ('confirmed', 'pending_approval') then
    perform public._fail('already_assigned', 'This volunteer is already down for this duty.');
  elsif found and v_existing.status = 'invited' then
    return jsonb_build_object('assignment_id', v_existing.id, 'status', 'invited');
  elsif found and v_existing.status = 'cancelled' then
    perform public._fail('shift_not_open', 'This duty has been cancelled.');
  elsif found then
    update public.assignments
       set status = 'invited', source = 'admin_allocation', assigned_by = v_me, responded_at = null, removal_reason = null
     where id = v_existing.id returning id into v_id;
  else
    insert into public.assignments (shift_id, volunteer_id, status, source, assigned_by)
    values (p_shift_id, p_volunteer_id, 'invited', 'admin_allocation', v_me) returning id into v_id;
  end if;
  perform public._notify_assignment(v_id, 'duty_invitation');
  return jsonb_build_object('assignment_id', v_id, 'status', 'invited');
end;
$$;

create function public.approve_assignment(p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
  v_shift public.event_shifts%rowtype;
begin
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then perform public._fail('not_found', 'Request not found.'); end if;
  perform public._assert_manager_of_shift(v_a.shift_id);
  perform 1 from public.volunteers where id = v_a.volunteer_id for update;
  select * into v_shift from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if v_a.status <> 'pending_approval' then perform public._fail('invalid_transition', 'This request is no longer pending.'); end if;
  perform public._check_can_commit(v_a.volunteer_id, v_shift, v_a.id);
  update public.assignments set status = 'confirmed', assigned_by = v_me where id = v_a.id;
  perform public._notify_assignment(v_a.id, 'approval_confirmed');
  return jsonb_build_object('assignment_id', v_a.id, 'status', 'confirmed');
end;
$$;

create function public.reject_assignment(p_assignment_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
begin
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then perform public._fail('not_found', 'Request not found.'); end if;
  perform public._assert_manager_of_shift(v_a.shift_id);
  perform 1 from public.volunteers where id = v_a.volunteer_id for update;
  perform 1 from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if v_a.status <> 'pending_approval' then perform public._fail('invalid_transition', 'This request is no longer pending.'); end if;
  update public.assignments set status = 'declined', assigned_by = v_me,
         removal_reason = nullif(btrim(left(p_reason, 500)), '') where id = v_a.id;
  perform public._notify_assignment(v_a.id, 'approval_declined');
  return jsonb_build_object('assignment_id', v_a.id, 'status', 'declined');
end;
$$;

create function public.remove_assignment(p_assignment_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then perform public._fail('reason_required', 'Give a reason for removing this volunteer.'); end if;
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then perform public._fail('not_found', 'Assignment not found.'); end if;
  perform public._assert_manager_of_shift(v_a.shift_id);
  perform 1 from public.volunteers where id = v_a.volunteer_id for update;
  perform 1 from public.event_shifts where id = v_a.shift_id for update;
  select * into v_a from public.assignments where id = p_assignment_id;
  if v_a.status not in ('invited', 'pending_approval', 'confirmed') then
    perform public._fail('invalid_transition', 'This volunteer is not currently on the duty.');
  end if;
  update public.assignments set status = 'removed', assigned_by = v_me, removal_reason = left(btrim(p_reason), 500)
   where id = v_a.id;
  update public.cancellation_requests set status = 'approved', resolved_by = v_me, resolved_at = now()
   where assignment_id = v_a.id and status = 'pending';
  perform public._notify_assignment(v_a.id, 'assignment_removed');
  return jsonb_build_object('assignment_id', v_a.id, 'status', 'removed');
end;
$$;

create function public.resolve_cancellation_request(p_request_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_r public.cancellation_requests%rowtype;
  v_a public.assignments%rowtype;
begin
  select * into v_r from public.cancellation_requests where id = p_request_id;
  if not found then perform public._fail('not_found', 'Request not found.'); end if;
  select * into v_a from public.assignments where id = v_r.assignment_id;
  perform public._assert_manager_of_shift(v_a.shift_id);
  perform 1 from public.volunteers where id = v_a.volunteer_id for update;
  perform 1 from public.event_shifts where id = v_a.shift_id for update;
  select * into v_r from public.cancellation_requests where id = p_request_id for update;
  if v_r.status <> 'pending' then perform public._fail('invalid_transition', 'This request has already been dealt with.'); end if;
  update public.cancellation_requests
     set status = case when p_approve then 'approved'::public.cancellation_request_status else 'declined' end,
         resolved_by = v_me, resolved_at = now()
   where id = v_r.id;
  if p_approve then
    select * into v_a from public.assignments where id = v_r.assignment_id;
    if v_a.status in ('confirmed', 'pending_approval') then
      update public.assignments set status = 'withdrawn', removal_reason = 'Late cancellation approved' where id = v_a.id;
    end if;
    perform public._notify_assignment(v_a.id, 'cancellation_approved');
  else
    perform public._notify_assignment(v_a.id, 'cancellation_declined');
  end if;
  return jsonb_build_object('request_id', v_r.id, 'approved', p_approve);
end;
$$;

create function public.mark_attendance(p_assignment_id uuid, p_attendance public.attendance_status) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_a public.assignments%rowtype;
  v_shift public.event_shifts%rowtype;
begin
  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then perform public._fail('not_found', 'Assignment not found.'); end if;
  perform public._assert_manager_of_shift(v_a.shift_id);
  select * into v_shift from public.event_shifts where id = v_a.shift_id;
  if v_a.status <> 'confirmed' then perform public._fail('invalid_transition', 'Attendance applies to confirmed volunteers only.'); end if;
  if v_shift.starts_at > now() then perform public._fail('shift_not_started', 'Attendance can be marked once the duty has started.'); end if;
  update public.assignments set attendance_status = p_attendance, attendance_marked_by = v_me, attendance_marked_at = now()
   where id = v_a.id;
  return jsonb_build_object('assignment_id', v_a.id, 'attendance', p_attendance);
end;
$$;

-- ---------------------------------------------------------------------------
-- Event & shift lifecycle (organisers)
-- ---------------------------------------------------------------------------
create function public._reset_assignments_for_reconfirm(p_shift_ids uuid[], p_kind text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.assignments
           where shift_id = any (p_shift_ids) and status in ('invited', 'pending_approval', 'confirmed')
           for update
  loop
    update public.assignments set status = 'invited', responded_at = null where id = r.id;
    -- status_changed_at is bumped by the transition trigger even for invited→invited via this update:
    update public.assignments set status_changed_at = clock_timestamp() where id = r.id;
    perform public._notify_assignment(r.id, p_kind);
    n := n + 1;
  end loop;
  -- Old reminders must never fire for a commitment that now needs reconfirming.
  update public.notification_outbox set status = 'suppressed'
   where status = 'pending' and kind = 'reminder' and entity_type = 'assignments'
     and entity_id in (select id from public.assignments where shift_id = any (p_shift_ids));
  return n;
end;
$$;

create function public._cancel_assignments(p_shift_ids uuid[], p_kind text) returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id from public.assignments
           where shift_id = any (p_shift_ids) and status in ('invited', 'pending_approval', 'confirmed')
           for update
  loop
    update public.assignments set status = 'cancelled' where id = r.id;
    perform public._notify_assignment(r.id, p_kind);
    n := n + 1;
  end loop;
  update public.notification_outbox set status = 'suppressed'
   where status = 'pending' and kind = 'reminder' and entity_type = 'assignments'
     and entity_id in (select id from public.assignments where shift_id = any (p_shift_ids));
  update public.cancellation_requests set status = 'approved', resolved_at = now()
   where status = 'pending' and assignment_id in (select id from public.assignments where shift_id = any (p_shift_ids));
  return n;
end;
$$;

create function public._alert_dependent_events(p_coverage_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  for d in select id, venue_id, title, starts_at, is_demo from public.events
           where coverage_event_id = p_coverage_event_id and status in ('draft', 'published', 'postponed')
  loop
    perform public._notify_managers(d.venue_id, 'venue_cover_at_risk', 'events', d.id,
      jsonb_build_object('event_id', d.id, 'event_title', d.title, 'starts_at', d.starts_at), d.is_demo);
  end loop;
end;
$$;

create function public.publish_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_has_lead boolean;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status not in ('draft', 'postponed') then perform public._fail('invalid_transition', 'Only draft or postponed events can be published.'); end if;
  if not exists (select 1 from public.event_shifts where event_id = p_event_id and status = 'active') then
    perform public._fail('publish_blocked', 'Add at least one duty before publishing.');
  end if;
  v_has_lead := exists (select 1 from public.event_shifts s join public.duty_types dt on dt.id = s.duty_type_id
                        where s.event_id = p_event_id and s.status = 'active' and dt.code = 'site_lead');
  -- Site responsibility must be explicitly resolved before publishing (Catalogue T03/T05, Spec D1.4).
  if v_e.site_responsibility and v_e.site_cover_source = 'club_volunteer' and not v_has_lead
     and (v_e.coverage_event_id is null or v_e.event_type = 'venue_coverage') then
    perform public._fail('publish_blocked',
      'The club is responsible for the site: add a site-lead duty, link venue-wide cover, or record an external-cover decision.');
  end if;
  update public.events set status = 'published', status_reason = null where id = p_event_id;
  return jsonb_build_object('event_id', p_event_id, 'status', 'published');
end;
$$;

-- Admin-only: record that site operations are provided externally or not required. Club-volunteer
-- cover may be restored by any manager of the venue.
create function public.set_site_cover(p_event_id uuid, p_source public.site_cover_source, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_e public.events%rowtype;
begin
  select * into v_e from public.events where id = p_event_id for update;
  if not found or not public.can_manage_venue(v_e.venue_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  if p_source <> 'club_volunteer' then
    if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can record external or not-required cover.'); end if;
    if p_note is null or btrim(p_note) = '' then perform public._fail('reason_required', 'Record who provides cover / why it is not needed.'); end if;
    update public.events set site_cover_source = p_source, external_cover_note = left(btrim(p_note), 1000),
           external_cover_verified_by = v_me, external_cover_verified_at = now() where id = p_event_id;
  else
    update public.events set site_cover_source = 'club_volunteer', external_cover_note = null,
           external_cover_verified_by = null, external_cover_verified_at = null where id = p_event_id;
    if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  end if;
  return jsonb_build_object('event_id', p_event_id, 'site_cover_source', p_source);
end;
$$;

create function public.cancel_event(p_event_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_shift_ids uuid[];
  n int;
begin
  if p_reason is null or btrim(p_reason) = '' then perform public._fail('reason_required', 'Give a reason for cancelling.'); end if;
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status in ('cancelled', 'completed') then perform public._fail('invalid_transition', 'This event is already closed.'); end if;
  select coalesce(array_agg(id order by id), '{}') into v_shift_ids
    from (select id from public.event_shifts where event_id = p_event_id order by id for update) s;
  update public.events set status = 'cancelled', status_reason = left(btrim(p_reason), 500) where id = p_event_id;
  update public.event_shifts set status = 'cancelled' where event_id = p_event_id and status = 'active';
  n := public._cancel_assignments(v_shift_ids, 'event_cancelled');
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  return jsonb_build_object('event_id', p_event_id, 'status', 'cancelled', 'assignments_cancelled', n);
end;
$$;

create function public.postpone_event(p_event_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_shift_ids uuid[];
  n int;
begin
  if p_reason is null or btrim(p_reason) = '' then perform public._fail('reason_required', 'Give a reason for postponing.'); end if;
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status <> 'published' then perform public._fail('invalid_transition', 'Only published events can be postponed.'); end if;
  select coalesce(array_agg(id order by id), '{}') into v_shift_ids
    from (select id from public.event_shifts where event_id = p_event_id and status = 'active' order by id for update) s;
  update public.events set status = 'postponed', status_reason = left(btrim(p_reason), 500) where id = p_event_id;
  n := public._reset_assignments_for_reconfirm(v_shift_ids, 'event_postponed');
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  return jsonb_build_object('event_id', p_event_id, 'status', 'postponed', 'assignments_reset', n);
end;
$$;

-- Material time change. Shifts generated from a template item are re-anchored to the new start/end;
-- hand-made shifts move with the start. All active assignments must reconfirm (Spec D5.3).
create function public.reschedule_event(p_event_id uuid, p_starts_at timestamptz, p_ends_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_e public.events%rowtype;
  v_delta interval;
  s record;
  v_ns timestamptz; v_ne timestamptz;
  v_shift_ids uuid[];
  n int := 0;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    perform public._fail('invalid_times', 'The event must end after it starts.');
  end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status not in ('draft', 'published', 'postponed') then perform public._fail('invalid_transition', 'This event is closed.'); end if;
  if v_e.starts_at = p_starts_at and v_e.ends_at = p_ends_at then
    return jsonb_build_object('event_id', p_event_id, 'assignments_reset', 0);
  end if;
  v_delta := p_starts_at - v_e.starts_at;

  update public.events set starts_at = p_starts_at, ends_at = p_ends_at,
         kickoff_at = case when kickoff_at is null then null else kickoff_at + v_delta end
   where id = p_event_id;

  for s in select sh.*, ti.start_anchor, ti.start_offset_minutes, ti.end_anchor, ti.end_offset_minutes
           from public.event_shifts sh left join public.duty_template_items ti on ti.id = sh.source_template_item_id
           where sh.event_id = p_event_id and sh.status = 'active' order by sh.id for update of sh
  loop
    if s.start_anchor is not null then
      v_ns := (case s.start_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => s.start_offset_minutes);
      v_ne := (case s.end_anchor when 'event_start' then p_starts_at else p_ends_at end) + make_interval(mins => s.end_offset_minutes);
    else
      v_ns := s.starts_at + v_delta;
      v_ne := s.ends_at + v_delta;
    end if;
    update public.event_shifts set starts_at = v_ns, ends_at = v_ne where id = s.id;
    v_shift_ids := array_append(v_shift_ids, s.id);
  end loop;

  if v_shift_ids is not null then
    n := public._reset_assignments_for_reconfirm(v_shift_ids, 'reconfirm_needed');
  end if;
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(p_event_id); end if;
  return jsonb_build_object('event_id', p_event_id, 'assignments_reset', n);
end;
$$;

-- Change one shift's times / headcount / sign-up rules atomically.
create function public.update_shift(
  p_shift_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_required_count integer,
  p_signup_enabled boolean default null, p_approval_required boolean default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_s public.event_shifts%rowtype;
  v_e public.events%rowtype;
  c record;
  n int := 0;
begin
  perform public._assert_manager_of_shift(p_shift_id);
  select * into v_s from public.event_shifts where id = p_shift_id for update;
  select * into v_e from public.events where id = v_s.event_id;
  if v_s.status <> 'active' or v_e.status in ('cancelled', 'completed') then
    perform public._fail('invalid_transition', 'This duty is closed.');
  end if;
  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    perform public._fail('invalid_times', 'The duty must end after it starts.');
  end if;
  if p_required_count is null or p_required_count < 1 then
    perform public._fail('invalid_headcount', 'At least one volunteer is required.');
  end if;
  select confirmed, pending into c from public._shift_counts(p_shift_id);
  if p_required_count < c.confirmed + c.pending then
    perform public._fail('below_committed',
      format('%s volunteer(s) are already committed. Remove someone before lowering the number needed.', c.confirmed + c.pending));
  end if;
  update public.event_shifts
     set starts_at = p_starts_at, ends_at = p_ends_at, required_count = p_required_count,
         signup_enabled = coalesce(p_signup_enabled, signup_enabled),
         approval_required = coalesce(p_approval_required, approval_required)
   where id = p_shift_id;
  if p_starts_at <> v_s.starts_at or p_ends_at <> v_s.ends_at then
    n := public._reset_assignments_for_reconfirm(array[p_shift_id], 'reconfirm_needed');
    if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(v_e.id); end if;
  end if;
  return jsonb_build_object('shift_id', p_shift_id, 'assignments_reset', n);
end;
$$;

create function public.cancel_shift(p_shift_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public._require_caller();
  v_s public.event_shifts%rowtype;
  v_e public.events%rowtype;
  n int;
begin
  if p_reason is null or btrim(p_reason) = '' then perform public._fail('reason_required', 'Give a reason.'); end if;
  perform public._assert_manager_of_shift(p_shift_id);
  select * into v_s from public.event_shifts where id = p_shift_id for update;
  if v_s.status <> 'active' then perform public._fail('invalid_transition', 'This duty is already cancelled.'); end if;
  update public.event_shifts set status = 'cancelled' where id = p_shift_id;
  n := public._cancel_assignments(array[p_shift_id], 'shift_cancelled');
  select * into v_e from public.events where id = v_s.event_id;
  if v_e.event_type = 'venue_coverage' then perform public._alert_dependent_events(v_e.id); end if;
  return jsonb_build_object('shift_id', p_shift_id, 'status', 'cancelled', 'assignments_cancelled', n);
end;
$$;

create function public.complete_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_e public.events%rowtype;
begin
  if not public.can_manage_event(p_event_id) then perform public._fail('not_authorised', 'You do not manage this venue.'); end if;
  select * into v_e from public.events where id = p_event_id for update;
  if v_e.status <> 'published' then perform public._fail('invalid_transition', 'Only published events can be completed.'); end if;
  if v_e.ends_at > now() then perform public._fail('event_not_finished', 'The event has not finished yet.'); end if;
  update public.events set status = 'completed' where id = p_event_id;
  return jsonb_build_object('event_id', p_event_id, 'status', 'completed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create function public.set_duty_authorisation(
  p_volunteer_id uuid, p_duty_code text, p_active boolean, p_valid_until timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_duty uuid; v_id uuid;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can change duty authorisations.'); end if;
  select id into v_duty from public.duty_types where code = p_duty_code;
  if v_duty is null then perform public._fail('not_found', 'Unknown duty.'); end if;
  if not exists (select 1 from public.volunteers where id = p_volunteer_id) then perform public._fail('not_found', 'Volunteer not found.'); end if;
  insert into public.volunteer_duty_authorisations (volunteer_id, duty_type_id, approved_by, approved_at, valid_until, active)
  values (p_volunteer_id, v_duty, v_me, now(), p_valid_until, p_active)
  on conflict (volunteer_id, duty_type_id) do update
    set approved_by = excluded.approved_by, approved_at = excluded.approved_at,
        valid_until = excluded.valid_until, active = excluded.active
  returning id into v_id;
  -- Losing an authorisation may break venue cover: alert organisers of affected future coverage events.
  if not p_active or (p_valid_until is not null and p_valid_until <= now() + interval '30 days') then
    perform public._alert_dependent_events(e.id)
    from public.events e
    where e.event_type = 'venue_coverage' and e.ends_at > now() and e.status in ('published', 'postponed')
      and exists (select 1 from public.event_shifts s join public.assignments a on a.shift_id = s.id
                  where s.event_id = e.id and a.volunteer_id = p_volunteer_id and a.status = 'confirmed');
  end if;
  return jsonb_build_object('authorisation_id', v_id, 'active', p_active, 'valid_until', p_valid_until);
end;
$$;

create function public.admin_set_volunteer_access(p_volunteer_id uuid, p_role public.app_role, p_is_active boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public._require_caller(); v_t public.volunteers%rowtype;
begin
  if not public.is_admin() then perform public._fail('not_authorised', 'Only an administrator can change access.'); end if;
  select * into v_t from public.volunteers where id = p_volunteer_id for update;
  if not found then perform public._fail('not_found', 'Volunteer not found.'); end if;
  -- Serialise admin changes so two admins can't demote each other simultaneously.
  perform 1 from public.volunteers where role = 'admin' and is_active for update;
  if v_t.role = 'admin' and v_t.is_active and (p_role <> 'admin' or not p_is_active)
     and (select count(*) from public.volunteers where role = 'admin' and is_active and id <> v_t.id) = 0 then
    perform public._fail('last_admin', 'The club must keep at least one active administrator.');
  end if;
  update public.volunteers set role = p_role, is_active = p_is_active where id = p_volunteer_id;
  if p_role <> 'coordinator' then delete from public.coordinator_venues where volunteer_id = p_volunteer_id; end if;
  return jsonb_build_object('volunteer_id', p_volunteer_id, 'role', p_role, 'is_active', p_is_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- Safe read functions
-- ---------------------------------------------------------------------------
-- Staffing per shift. Volunteers see confirmed/pending/open counts and their own status,
-- never who else is invited. Managers also see invited counts.
create function public.event_shift_staffing(p_event_id uuid)
returns table (shift_id uuid, required_count int, confirmed_count int, pending_count int, invited_count int,
               open_slots int, my_status public.assignment_status, my_missing_authorisations text[])
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_volunteer_id(); v_mgr boolean;
begin
  if v_me is null or not public.can_view_event(p_event_id) then return; end if;
  v_mgr := public.can_manage_event(p_event_id);
  return query
  select s.id, s.required_count, c.confirmed, c.pending,
         case when v_mgr then c.invited end,
         greatest(0, s.required_count - c.confirmed - c.pending),
         (select a.status from public.assignments a where a.shift_id = s.id and a.volunteer_id = v_me),
         public.missing_authorisations(v_me, s.id, s.ends_at)
  from public.event_shifts s
  cross join lateral public._shift_counts(s.id) c
  where s.event_id = p_event_id and s.status = 'active'
  order by s.starts_at, s.id;
end;
$$;

-- Names only. A volunteer sees the confirmed names on a published event they are themselves on;
-- managers of the venue see them for any event. Never emails or phone numbers.
create function public.event_roster(p_event_id uuid)
returns table (shift_id uuid, display_name text)
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := public.current_volunteer_id();
begin
  if v_me is null then return; end if;
  if not public.can_manage_event(p_event_id) and not exists (
       select 1 from public.events e join public.event_shifts s on s.event_id = e.id
       join public.assignments a on a.shift_id = s.id
       where e.id = p_event_id and e.status in ('published', 'completed')
         and a.volunteer_id = v_me and a.status in ('confirmed', 'pending_approval')) then
    return;
  end if;
  return query
  select s.id, v.display_name
  from public.event_shifts s
  join public.assignments a on a.shift_id = s.id and a.status = 'confirmed'
  join public.volunteers v on v.id = a.volunteer_id
  where s.event_id = p_event_id and s.status = 'active'
  order by s.starts_at, v.display_name;
end;
$$;

-- Manager's picker for allocation: names plus eligibility/clash flags. No contact details.
create function public.volunteer_picker(p_shift_id uuid)
returns table (volunteer_id uuid, display_name text, eligible boolean, missing_authorisations text[], has_overlap boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_s public.event_shifts%rowtype;
begin
  if not public.can_manage_shift(p_shift_id) then return; end if;
  select * into v_s from public.event_shifts where id = p_shift_id;
  return query
  select v.id, v.display_name,
         cardinality(public.missing_authorisations(v.id, p_shift_id, v_s.ends_at)) = 0,
         public.missing_authorisations(v.id, p_shift_id, v_s.ends_at),
         public._has_overlap(v.id, p_shift_id)
  from public.volunteers v
  where v.is_active
  order by v.display_name;
end;
$$;

-- Site-operations coverage for an event (Catalogue §3/§5, agreed Q5).
--  required window = earliest start to latest end of the event AND all its active shifts
--  covered         = union of active site_lead shift intervals (on the linked venue_coverage
--                    event and/or this event) that have >= 1 CONFIRMED volunteer who is active
--                    and fully authorised for every restricted duty on that shift.
-- States: not_required | covered_by_provider | covered_by_volunteer | at_risk | no_cover
create function public.event_site_coverage(p_event_id uuid)
returns table (state text, coverage_event_id uuid, required_window tstzrange, gaps tstzmultirange)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_e public.events%rowtype;
  v_c public.events%rowtype;
  v_window tstzrange;
  v_covered tstzmultirange;
  v_gaps tstzmultirange;
  v_has_arrangement boolean;
begin
  if not public.can_manage_event(p_event_id) then return; end if;
  select * into v_e from public.events where id = p_event_id;

  select tstzrange(min(x.s), max(x.e), '[)') into v_window from (
    select v_e.starts_at as s, v_e.ends_at as e
    union all
    select starts_at, ends_at from public.event_shifts where event_id = p_event_id and status = 'active') x;

  if not v_e.site_responsibility or v_e.site_cover_source = 'not_required' then
    return query select 'not_required'::text, v_e.coverage_event_id, v_window, '{}'::tstzmultirange; return;
  end if;
  if v_e.site_cover_source = 'provider_verified' then
    return query select 'covered_by_provider'::text, v_e.coverage_event_id, v_window, '{}'::tstzmultirange; return;
  end if;

  if v_e.coverage_event_id is not null then
    select * into v_c from public.events where id = v_e.coverage_event_id;
    if v_c.status <> 'cancelled' and v_c.site_cover_source = 'provider_verified' then
      return query select 'covered_by_provider'::text, v_c.id, v_window, '{}'::tstzmultirange; return;
    end if;
  end if;

  select range_agg(tstzrange(s.starts_at, s.ends_at, '[)')) into v_covered
  from public.event_shifts s
  join public.duty_types dt on dt.id = s.duty_type_id and dt.code = 'site_lead'
  join public.events ev on ev.id = s.event_id
  where s.status = 'active' and ev.status in ('published', 'completed', 'draft')
    and (s.event_id = v_e.id or (v_c.id is not null and s.event_id = v_c.id and v_c.status <> 'cancelled'))
    and exists (
      select 1 from public.assignments a
      where a.shift_id = s.id and a.status = 'confirmed'
        and public.volunteer_is_eligible(a.volunteer_id, s.id, s.ends_at));

  v_gaps := tstzmultirange(v_window) - coalesce(v_covered, '{}'::tstzmultirange);
  v_has_arrangement := v_c.id is not null or exists (
    select 1 from public.event_shifts s join public.duty_types dt on dt.id = s.duty_type_id
    where s.event_id = v_e.id and s.status = 'active' and dt.code = 'site_lead');

  return query select
    case when isempty(v_gaps) then 'covered_by_volunteer'
         when v_has_arrangement then 'at_risk'
         else 'no_cover' end,
    v_c.id, v_window, v_gaps;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the public RPCs above, only to signed-in users.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.current_volunteer_id(), public.current_app_role(), public.link_volunteer_account(),
  public.is_admin(), public.is_manager(), public.can_manage_venue(uuid), public.can_manage_event(uuid),
  public.can_view_event(uuid), public.can_view_shift(uuid), public.can_manage_shift(uuid),
  public.coordinator_can_see_volunteer(uuid),
  public.self_signup(uuid), public.accept_invitation(uuid), public.decline_invitation(uuid),
  public.withdraw_assignment(uuid), public.request_cancellation(uuid, text),
  public.allocate_volunteer(uuid, uuid), public.approve_assignment(uuid), public.reject_assignment(uuid, text),
  public.remove_assignment(uuid, text), public.resolve_cancellation_request(uuid, boolean),
  public.mark_attendance(uuid, public.attendance_status),
  public.publish_event(uuid), public.set_site_cover(uuid, public.site_cover_source, text),
  public.cancel_event(uuid, text), public.postpone_event(uuid, text),
  public.reschedule_event(uuid, timestamptz, timestamptz),
  public.update_shift(uuid, timestamptz, timestamptz, integer, boolean, boolean),
  public.cancel_shift(uuid, text), public.complete_event(uuid),
  public.set_duty_authorisation(uuid, text, boolean, timestamptz),
  public.admin_set_volunteer_access(uuid, public.app_role, boolean),
  public.event_shift_staffing(uuid), public.event_roster(uuid), public.volunteer_picker(uuid),
  public.event_site_coverage(uuid)
to authenticated;
