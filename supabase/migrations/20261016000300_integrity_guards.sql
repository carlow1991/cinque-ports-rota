-- Phase 2 (2/5): integrity guards enforced in the database regardless of caller.

-- ---------------------------------------------------------------------------
-- Venue-wide coverage links (Spec §E, Catalogue §3)
--  * a link must point to a DIFFERENT event of type venue_coverage at the SAME venue;
--  * a venue_coverage event may not itself link to another (so chains have length 1,
--    which makes cycles impossible by construction);
--  * a coverage event that others depend on may not change venue or stop being venue_coverage.
-- ---------------------------------------------------------------------------
create function public.guard_event_coverage_link() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_target public.events%rowtype;
begin
  if new.coverage_event_id is not null then
    if new.coverage_event_id = new.id then
      raise exception using errcode = 'P0001', message = 'coverage_link_self',
        detail = 'An event cannot provide venue cover for itself.';
    end if;
    if new.event_type = 'venue_coverage' then
      raise exception using errcode = 'P0001', message = 'coverage_link_from_coverage',
        detail = 'A venue-coverage event cannot link to another coverage event.';
    end if;
    select * into v_target from public.events where id = new.coverage_event_id;
    if not found or v_target.event_type <> 'venue_coverage' then
      raise exception using errcode = 'P0001', message = 'coverage_link_not_coverage',
        detail = 'Events can only link to a venue-coverage event.';
    end if;
    if v_target.venue_id <> new.venue_id then
      raise exception using errcode = 'P0001', message = 'coverage_link_other_venue',
        detail = 'Venue cover must be at the same venue.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and (new.venue_id <> old.venue_id or new.event_type <> old.event_type)
     and exists (select 1 from public.events d where d.coverage_event_id = new.id) then
    raise exception using errcode = 'P0001', message = 'coverage_event_has_dependents',
      detail = 'Other events rely on this venue cover; unlink them before changing its venue or type.';
  end if;
  return new;
end;
$$;

create trigger events_guard_coverage_link
  before insert or update of coverage_event_id, venue_id, event_type on public.events
  for each row execute function public.guard_event_coverage_link();

-- ---------------------------------------------------------------------------
-- Composite responsibilities never duplicate the primary duty
-- ---------------------------------------------------------------------------
create function public.guard_template_responsibility() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.duty_template_items i
             where i.id = new.template_item_id and i.duty_type_id = new.duty_type_id) then
    raise exception using errcode = 'P0001', message = 'responsibility_is_primary',
      detail = 'An included responsibility cannot repeat the shift''s primary duty.';
  end if;
  return new;
end;
$$;
create trigger template_item_responsibilities_guard
  before insert or update on public.template_item_responsibilities
  for each row execute function public.guard_template_responsibility();

create function public.guard_shift_responsibility() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.event_shifts s
             where s.id = new.shift_id and s.duty_type_id = new.duty_type_id) then
    raise exception using errcode = 'P0001', message = 'responsibility_is_primary',
      detail = 'An included responsibility cannot repeat the shift''s primary duty.';
  end if;
  return new;
end;
$$;
create trigger event_shift_responsibilities_guard
  before insert or update on public.event_shift_responsibilities
  for each row execute function public.guard_shift_responsibility();

-- A shift must stay within a sensible window of its event (offsets are at most ±24h).
create function public.guard_shift_window() returns trigger
language plpgsql set search_path = '' as $$
declare v_event public.events%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if new.starts_at < v_event.starts_at - interval '24 hours'
     or new.ends_at > v_event.ends_at + interval '24 hours' then
    raise exception using errcode = 'P0001', message = 'shift_outside_event_window',
      detail = 'Shift times must be within 24 hours of the event.';
  end if;
  return new;
end;
$$;
create trigger event_shifts_guard_window
  before insert or update of starts_at, ends_at, event_id on public.event_shifts
  for each row execute function public.guard_shift_window();

-- ---------------------------------------------------------------------------
-- Central assignment state machine (Spec §E: "validated by central transition functions")
-- ---------------------------------------------------------------------------
create function public.assignment_transition_allowed(
  p_from public.assignment_status, p_to public.assignment_status
) returns boolean
language sql immutable set search_path = '' as $$
  select case p_from
    when 'invited'          then p_to in ('confirmed', 'pending_approval', 'declined', 'removed', 'cancelled', 'invited')
    when 'pending_approval' then p_to in ('confirmed', 'declined', 'withdrawn', 'removed', 'cancelled', 'invited')
    when 'confirmed'        then p_to in ('withdrawn', 'removed', 'cancelled', 'invited')
    -- Finished rows may be reused (unique shift+volunteer) by a fresh invite or sign-up.
    when 'declined'         then p_to in ('invited', 'confirmed', 'pending_approval')
    when 'withdrawn'        then p_to in ('invited', 'confirmed', 'pending_approval')
    when 'removed'          then p_to in ('invited', 'confirmed', 'pending_approval')
    when 'cancelled'        then false
  end
$$;

create function public.guard_assignment_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.shift_id <> old.shift_id or new.volunteer_id <> old.volunteer_id then
    raise exception using errcode = 'P0001', message = 'assignment_immutable',
      detail = 'An assignment cannot be moved to another shift or person.';
  end if;
  if new.status is distinct from old.status then
    if not public.assignment_transition_allowed(old.status, new.status)
       -- invited→invited is a re-invite/reconfirm; other no-ops never reach here.
    then
      raise exception using errcode = 'P0001', message = 'invalid_transition',
        detail = format('Cannot change an assignment from %s to %s.', old.status, new.status);
    end if;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger assignments_guard_transition
  before update on public.assignments
  for each row execute function public.guard_assignment_transition();

-- New rows may only start in an "active" state.
create function public.guard_assignment_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status not in ('invited', 'pending_approval', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'invalid_transition',
      detail = 'New assignments must start as invited, pending approval or confirmed.';
  end if;
  return new;
end;
$$;
create trigger assignments_guard_insert
  before insert on public.assignments
  for each row execute function public.guard_assignment_insert();

-- ---------------------------------------------------------------------------
-- Audit log: written by trigger (no client can write it). Personal contact data is redacted.
-- ---------------------------------------------------------------------------
create function public.audit_row_change() returns trigger
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
    return null; -- nothing meaningful changed
  end if;
  -- Use the row's uuid key where it has one (club_settings has a smallint id; link tables use volunteer_id).
  v_id := (select x::uuid from unnest(array[v_new ->> 'id', v_old ->> 'id', v_new ->> 'volunteer_id', v_old ->> 'volunteer_id']) x
           where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 1);
  insert into public.audit_log (actor_volunteer_id, action, entity_type, entity_id, old_data, new_data)
  values (public.current_volunteer_id(), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['volunteers','coordinator_venues','volunteer_duty_authorisations','venues','teams',
                           'duty_types','duty_templates','duty_template_items','events','event_shifts',
                           'assignments','cancellation_requests','club_settings']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;
