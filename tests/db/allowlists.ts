/**
 * Single source of truth for the privilege snapshot tests. Adding a callable function or a table
 * grant is a deliberate act: change the migration's grants AND this list.
 */
export const LEGACY_SIGNED_IN_FUNCTIONS = [
  "current_volunteer_id", "current_app_role", "link_volunteer_account", "is_admin", "is_manager", "can_manage_venue",
  "can_manage_event", "can_view_event", "can_view_shift", "can_manage_shift", "coordinator_can_see_volunteer",
  "self_signup", "accept_invitation", "decline_invitation", "withdraw_assignment", "request_cancellation",
  "allocate_volunteer", "approve_assignment", "reject_assignment", "remove_assignment", "resolve_cancellation_request",
  "mark_attendance", "publish_event", "set_site_cover", "cancel_event", "postpone_event", "reschedule_event",
  "update_shift", "cancel_shift", "complete_event", "create_event", "apply_template", "add_shift", "link_venue_cover",
  "set_duty_authorisation", "admin_set_volunteer_access", "admin_update_template_item", "admin_add_template_item",
  "event_shift_staffing", "event_roster", "volunteer_picker", "event_site_coverage", "manage_events_overview",
  "volunteer_rota", "volunteer_event_view", "my_duties", "volunteer_opportunities", "preview_reschedule", "admin_email_backlog", "admin_set_email_release",
  "manage_roster", "manage_action_queue", "event_cover_leads", "admin_create_volunteer", "admin_set_coordinator_venues",
  "admin_outbox_summary", "admin_retry_failed_emails",
];

/** Volunteer Hub functions callable by signed-in users (each re-checks the caller inside). */
export const HUB_SIGNED_IN_FUNCTIONS = [
  // Stage 1
  "current_person_id", "current_access_level", "hub_is_admin", "hub_is_manager", "hub_can_manage_venue", "hub_can_manage_team",
  "link_person_account", "hub_me", "hub_create_person", "hub_update_person", "hub_set_preferences", "hub_update_my_profile",
  "hub_create_team", "hub_set_team_role", "hub_prepare_portal_invite", "hub_record_invite_result", "hub_set_access",
  "hub_set_coordinator_scopes", "hub_directory",
];

export const SIGNED_IN_FUNCTIONS = [...new Set([...LEGACY_SIGNED_IN_FUNCTIONS, ...HUB_SIGNED_IN_FUNCTIONS])].sort();

/** The secret key (server only): email worker, first-admin bootstrap, and the two public-page functions. */
export const SERVICE_ROLE_FUNCTIONS = [
  "admin_bootstrap_volunteer", "outbox_claim", "outbox_complete", "outbox_enqueue_reminders", "outbox_suppress",
  "hub_bootstrap_person",
].sort();

/** Tables signed-in users can read (RLS narrows rows). No Hub table is directly writable. */
export const HUB_SELECT_ONLY_TABLES = [
  "people", "user_accounts", "coordinator_scopes", "team_people", "volunteer_preferences", "usual_availability",
];
