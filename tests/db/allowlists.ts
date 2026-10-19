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
  // Stage 2
  "hub_can_manage_event", "hub_create_event", "hub_update_event", "hub_set_event_status",
  // Stage 3
  "hub_request_availability", "hub_mark_request_contacted", "hub_respond_availability", "hub_record_availability",
  "hub_invite_to_help", "hub_respond_assignment", "hub_withdraw_assignment", "hub_record_assignment_response",
  "hub_cancel_assignment", "hub_set_expected_override", "hub_event_involvement", "hub_request_candidates",
  "hub_people_picker", "hub_my_home", "hub_open_requests", "hub_person_notes",
  // Stage 4
  "hub_create_venue_cover", "hub_update_venue_cover", "hub_venue_cover_preview", "hub_venue_covers", "hub_manage_overview",
  // Stage 5
  "hub_save_position", "hub_set_recruiting", "hub_add_holder", "hub_end_holder", "hub_set_interest", "hub_register_interest",
  "hub_add_suggested_positions", "hub_positions",
  // Stage 6
  "hub_update_application", "hub_link_application", "hub_create_person_from_application", "hub_match_application_position",
  "hub_recompute_suggestions", "hub_delete_application", "hub_application_counts",
  // Stage 7
  "hub_save_settings", "hub_anonymise_person", "hub_log_export",
];

export const SIGNED_IN_FUNCTIONS = [...new Set([...LEGACY_SIGNED_IN_FUNCTIONS, ...HUB_SIGNED_IN_FUNCTIONS])].sort();

/** The secret key (server only): email worker, first-admin bootstrap, and the two public-page functions. */
export const SERVICE_ROLE_FUNCTIONS = [
  "admin_bootstrap_volunteer", "outbox_claim", "outbox_complete", "outbox_enqueue_reminders", "outbox_suppress",
  "hub_bootstrap_person", "public_opportunities", "public_submit_application", "public_club_contact",
].sort();

/** Tables signed-in users can read (RLS narrows rows). No Hub table is directly writable. */
export const HUB_SELECT_ONLY_TABLES = [
  "people", "user_accounts", "coordinator_scopes", "team_people", "volunteer_preferences", "usual_availability",
  "availability_requests", "event_availability", "hub_assignments", "event_participation_exceptions",
  "club_positions", "position_holders", "position_interests",
  "volunteer_applications", "application_role_suggestions",
];
