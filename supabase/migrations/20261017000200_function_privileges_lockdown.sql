-- Security fix (found by Phase 4 tests): PostgreSQL grants EXECUTE on every new function to PUBLIC.
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA …` can only ADD to the global defaults, so the Phase 2
-- per-schema revoke did not stop that. Functions created in Phase 3/4 were therefore callable by
-- `anon` (each still refused to act without a signed-in volunteer, but that must not be the only barrier).
--
-- 1. Remove the global default for functions created by this role from now on.
-- 2. Re-lock every existing function: nobody may execute anything except the explicit allow-list
--    below, which is granted to signed-in users only. tests/db/privileges.db.test.ts sweeps this.

alter default privileges revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  -- identity & visibility helpers (used by RLS policies and the app)
  public.current_volunteer_id(), public.current_app_role(), public.link_volunteer_account(),
  public.is_admin(), public.is_manager(), public.can_manage_venue(uuid), public.can_manage_event(uuid),
  public.can_view_event(uuid), public.can_view_shift(uuid), public.can_manage_shift(uuid),
  public.coordinator_can_see_volunteer(uuid),
  -- volunteer actions
  public.self_signup(uuid), public.accept_invitation(uuid), public.decline_invitation(uuid),
  public.withdraw_assignment(uuid), public.request_cancellation(uuid, text),
  -- organiser actions
  public.allocate_volunteer(uuid, uuid), public.approve_assignment(uuid), public.reject_assignment(uuid, text),
  public.remove_assignment(uuid, text), public.resolve_cancellation_request(uuid, boolean),
  public.mark_attendance(uuid, public.attendance_status),
  public.publish_event(uuid), public.set_site_cover(uuid, public.site_cover_source, text),
  public.cancel_event(uuid, text), public.postpone_event(uuid, text),
  public.reschedule_event(uuid, timestamptz, timestamptz),
  public.update_shift(uuid, timestamptz, timestamptz, integer, boolean, boolean),
  public.cancel_shift(uuid, text), public.complete_event(uuid),
  public.create_event(uuid, text, public.event_type, timestamptz, timestamptz, uuid, timestamptz, text, text, text, text,
                      uuid, boolean, uuid, uuid[], jsonb),
  public.apply_template(uuid, uuid, uuid[], jsonb),
  public.add_shift(uuid, text, timestamptz, timestamptz, int, boolean, boolean, text, text[]),
  public.link_venue_cover(uuid, uuid),
  -- admin actions
  public.set_duty_authorisation(uuid, text, boolean, timestamptz),
  public.admin_set_volunteer_access(uuid, public.app_role, boolean),
  public.admin_update_template_item(uuid, int, boolean, public.template_time_anchor, int, public.template_time_anchor, int,
                                    boolean, boolean, boolean, text, text, text[]),
  public.admin_add_template_item(uuid, text),
  -- sanitised reads
  public.event_shift_staffing(uuid), public.event_roster(uuid), public.volunteer_picker(uuid),
  public.event_site_coverage(uuid), public.manage_events_overview(timestamptz, timestamptz, uuid),
  public.volunteer_rota(timestamptz, timestamptz, uuid), public.volunteer_event_view(uuid), public.my_duties()
to authenticated;
