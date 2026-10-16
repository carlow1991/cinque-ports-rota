-- Phase 2 (3/5): access helpers, grants and row level security on EVERY table.
-- Model: anon gets nothing. Inactive accounts get nothing (helpers return null/false).
-- Volunteers: published events/shifts, their own records. Coordinators: their venues.
-- Admins: everything. Sensitive state changes happen ONLY through the RPCs in 0500.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies don't recurse through other tables' RLS)
-- ---------------------------------------------------------------------------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'admin', false)
$$;

create function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() in ('admin', 'coordinator'), false)
$$;

create function public.can_manage_venue(p_venue_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.current_app_role()
    when 'admin' then true
    when 'coordinator' then exists (
      select 1 from public.coordinator_venues cv
      where cv.volunteer_id = public.current_volunteer_id() and cv.venue_id = p_venue_id)
    else false
  end
$$;

create function public.can_manage_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.can_manage_venue(e.venue_id) from public.events e where e.id = p_event_id), false)
$$;

create function public.can_view_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when public.current_volunteer_id() is null then false
      when e.status <> 'draft' then true
      else public.can_manage_venue(e.venue_id)
    end
    from public.events e where e.id = p_event_id), false)
$$;

create function public.can_view_shift(p_shift_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.can_view_event(s.event_id) from public.event_shifts s where s.id = p_shift_id), false)
$$;

create function public.can_manage_shift(p_shift_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.can_manage_event(s.event_id) from public.event_shifts s where s.id = p_shift_id), false)
$$;

-- Duty codes (primary + included) on a shift that require authorisation and that the
-- volunteer does NOT currently hold (active and unexpired at p_at). Empty array = eligible.
-- Agreed Q4: a composite shift needs a valid authorisation for EVERY restricted duty it includes.
create function public.missing_authorisations(p_volunteer_id uuid, p_shift_id uuid, p_at timestamptz default now())
returns text[]
language sql stable security definer set search_path = '' as $$
  with duties as (
    select s.duty_type_id from public.event_shifts s where s.id = p_shift_id
    union
    select r.duty_type_id from public.event_shift_responsibilities r where r.shift_id = p_shift_id
  )
  select coalesce(array_agg(dt.code order by dt.code), '{}')
  from duties d
  join public.duty_types dt on dt.id = d.duty_type_id
  where dt.requires_authorisation
    and not exists (
      select 1 from public.volunteer_duty_authorisations a
      where a.volunteer_id = p_volunteer_id and a.duty_type_id = d.duty_type_id
        and a.active and (a.valid_until is null or a.valid_until > p_at))
$$;

create function public.volunteer_is_eligible(p_volunteer_id uuid, p_shift_id uuid, p_at timestamptz default now())
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.volunteers v where v.id = p_volunteer_id and v.is_active)
     and cardinality(public.missing_authorisations(p_volunteer_id, p_shift_id, p_at)) = 0
$$;

-- Coordinators may see a volunteer's contact details only while that volunteer holds an
-- active assignment at one of the coordinator's venues (Q10).
create function public.coordinator_can_see_volunteer(p_volunteer_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_app_role() = 'coordinator' and exists (
    select 1
    from public.assignments a
    join public.event_shifts s on s.id = a.shift_id
    join public.events e on e.id = s.event_id
    join public.coordinator_venues cv on cv.venue_id = e.venue_id
    where a.volunteer_id = p_volunteer_id
      and a.status in ('invited', 'pending_approval', 'confirmed')
      and cv.volunteer_id = public.current_volunteer_id())
$$;

-- ---------------------------------------------------------------------------
-- Deny by default: strip every privilege, then grant precisely.
-- (Supabase's default privileges would otherwise grant ALL on new tables to anon/authenticated.)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['venues','teams','volunteers','coordinator_venues','duty_types',
    'volunteer_duty_authorisations','duty_templates','duty_template_items','template_item_responsibilities',
    'events','event_shifts','event_shift_responsibilities','assignments','cancellation_requests',
    'notification_outbox','audit_log','club_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference data: readable by any active volunteer; written by admins only.
grant select on public.venues, public.teams, public.duty_types, public.club_settings to authenticated;
grant insert, update on public.venues, public.teams, public.duty_types to authenticated;
grant update (withdrawal_cutoff_hours, reminder_day_before) on public.club_settings to authenticated;

create policy venues_read on public.venues for select to authenticated
  using ((select public.current_volunteer_id()) is not null);
create policy venues_admin_insert on public.venues for insert to authenticated with check ((select public.is_admin()));
create policy venues_admin_update on public.venues for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy teams_read on public.teams for select to authenticated
  using ((select public.current_volunteer_id()) is not null);
create policy teams_admin_insert on public.teams for insert to authenticated with check ((select public.is_admin()));
create policy teams_admin_update on public.teams for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy duty_types_read on public.duty_types for select to authenticated
  using ((select public.current_volunteer_id()) is not null);
create policy duty_types_admin_insert on public.duty_types for insert to authenticated with check ((select public.is_admin()));
create policy duty_types_admin_update on public.duty_types for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy club_settings_read on public.club_settings for select to authenticated
  using ((select public.current_volunteer_id()) is not null);
create policy club_settings_admin_update on public.club_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Volunteers (Phase 1 grants re-applied after the blanket revoke).
grant select on public.volunteers to authenticated;
grant update (display_name, phone, preferred_venue_id) on public.volunteers to authenticated;
create policy volunteers_select_coordinator on public.volunteers for select to authenticated
  using ((select public.coordinator_can_see_volunteer(id)));
-- volunteers_select_own, volunteers_select_admin, volunteers_update_own_profile already exist (Phase 1).

-- Coordinator venue scopes: own rows readable; managed by admins.
grant select, insert, delete on public.coordinator_venues to authenticated;
create policy coordinator_venues_read on public.coordinator_venues for select to authenticated
  using (volunteer_id = (select public.current_volunteer_id()) or (select public.is_admin()));
create policy coordinator_venues_admin_insert on public.coordinator_venues for insert to authenticated
  with check ((select public.is_admin()));
create policy coordinator_venues_admin_delete on public.coordinator_venues for delete to authenticated
  using ((select public.is_admin()));

-- Authorisations: a volunteer may see their own; admins all. Written only via set_duty_authorisation().
grant select on public.volunteer_duty_authorisations to authenticated;
create policy authorisations_read on public.volunteer_duty_authorisations for select to authenticated
  using (volunteer_id = (select public.current_volunteer_id()) or (select public.is_admin()));

-- Templates: managers read; admins write (Phase 3 admin UI). Deactivate rather than delete templates.
grant select on public.duty_templates, public.duty_template_items, public.template_item_responsibilities to authenticated;
grant insert, update on public.duty_templates to authenticated;
grant insert, update, delete on public.duty_template_items, public.template_item_responsibilities to authenticated;
create policy templates_read on public.duty_templates for select to authenticated using ((select public.is_manager()));
create policy templates_admin_insert on public.duty_templates for insert to authenticated with check ((select public.is_admin()));
create policy templates_admin_update on public.duty_templates for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy template_items_read on public.duty_template_items for select to authenticated using ((select public.is_manager()));
create policy template_items_admin_insert on public.duty_template_items for insert to authenticated with check ((select public.is_admin()));
create policy template_items_admin_update on public.duty_template_items for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy template_items_admin_delete on public.duty_template_items for delete to authenticated using ((select public.is_admin()));
create policy template_resp_read on public.template_item_responsibilities for select to authenticated using ((select public.is_manager()));
create policy template_resp_admin_insert on public.template_item_responsibilities for insert to authenticated with check ((select public.is_admin()));
create policy template_resp_admin_update on public.template_item_responsibilities for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy template_resp_admin_delete on public.template_item_responsibilities for delete to authenticated using ((select public.is_admin()));

-- Events: drafts visible only to managers of that venue. Managers may create DRAFT events at
-- their venues and edit descriptive fields directly. Times, venue, status and site-cover
-- decisions change only through RPCs (which reset/notify affected volunteers).
grant select on public.events to authenticated;
grant insert (venue_id, team_id, coverage_event_id, title, event_type, starts_at, ends_at, kickoff_at, opponent,
              competition, description, instructions, site_responsibility, is_demo) on public.events to authenticated;
grant update (team_id, coverage_event_id, title, kickoff_at, opponent, competition, description, instructions,
              site_responsibility) on public.events to authenticated;
-- Evaluated on the row's own columns (not by re-looking-up the id) so INSERT … RETURNING works.
create policy events_read on public.events for select to authenticated
  using ((select public.current_volunteer_id()) is not null
         and (status <> 'draft' or public.can_manage_venue(venue_id)));
create policy events_manager_insert on public.events for insert to authenticated
  with check (public.can_manage_venue(venue_id) and status = 'draft' and site_cover_source = 'club_volunteer');
create policy events_manager_update on public.events for update to authenticated
  using (public.can_manage_venue(venue_id)) with check (public.can_manage_venue(venue_id));

create function public.set_event_created_by() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.created_by := coalesce(public.current_volunteer_id(), new.created_by);
  return new;
end;
$$;
create trigger events_set_created_by before insert on public.events
  for each row execute function public.set_event_created_by();

-- Shifts: visible with their event. Managers may add shifts and edit instructions directly;
-- time / headcount / approval / status changes go through update_shift() / cancel_shift().
grant select on public.event_shifts, public.event_shift_responsibilities to authenticated;
grant insert (event_id, duty_type_id, starts_at, ends_at, required_count, signup_enabled, approval_required,
              instructions, source_template_item_id) on public.event_shifts to authenticated;
grant update (instructions) on public.event_shifts to authenticated;
grant insert, delete on public.event_shift_responsibilities to authenticated;
create policy shifts_read on public.event_shifts for select to authenticated using ((select public.can_view_event(event_id)));
create policy shifts_manager_insert on public.event_shifts for insert to authenticated
  with check (public.can_manage_event(event_id) and status = 'active'
              and (select e.status from public.events e where e.id = event_id) in ('draft', 'published', 'postponed'));
create policy shifts_manager_update on public.event_shifts for update to authenticated
  using (public.can_manage_event(event_id)) with check (public.can_manage_event(event_id));
create policy shift_resp_read on public.event_shift_responsibilities for select to authenticated
  using ((select public.can_view_shift(shift_id)));
-- Responsibilities can be changed only before anyone is committed to the shift (eligibility depends on them).
create policy shift_resp_manager_insert on public.event_shift_responsibilities for insert to authenticated
  with check (public.can_manage_shift(shift_id) and not exists (
    select 1 from public.assignments a where a.shift_id = event_shift_responsibilities.shift_id
      and a.status in ('invited', 'pending_approval', 'confirmed')));
create policy shift_resp_manager_delete on public.event_shift_responsibilities for delete to authenticated
  using (public.can_manage_shift(shift_id) and not exists (
    select 1 from public.assignments a where a.shift_id = event_shift_responsibilities.shift_id
      and a.status in ('invited', 'pending_approval', 'confirmed')));

-- Assignments: read own, or all at managed venues. NO direct writes: RPCs only.
grant select on public.assignments to authenticated;
create policy assignments_read on public.assignments for select to authenticated
  using (volunteer_id = (select public.current_volunteer_id()) or public.can_manage_shift(shift_id));

grant select on public.cancellation_requests to authenticated;
create policy cancellation_requests_read on public.cancellation_requests for select to authenticated
  using (volunteer_id = (select public.current_volunteer_id())
         or public.can_manage_shift((select a.shift_id from public.assignments a where a.id = assignment_id)));

-- Audit log: admins read. Nobody writes except the audit trigger.
grant select on public.audit_log to authenticated;
create policy audit_log_admin_read on public.audit_log for select to authenticated using ((select public.is_admin()));

-- notification_outbox: no client access at all (server worker uses the secret key). RLS on, no policies.

-- Helper execute grants (used inside policies and by the app).
grant execute on function public.current_volunteer_id(), public.current_app_role(), public.link_volunteer_account(),
  public.is_admin(), public.is_manager(), public.can_manage_venue(uuid), public.can_manage_event(uuid),
  public.can_view_event(uuid), public.can_view_shift(uuid), public.can_manage_shift(uuid),
  public.coordinator_can_see_volunteer(uuid)
  to authenticated;
