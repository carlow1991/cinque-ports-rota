import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";

/**
 * Sweep EVERY function in the public schema. Any new function must either be deliberately added
 * to the allow-list (and the lockdown migration) or stay uncallable. Catches the PUBLIC default-
 * execute trap that let Phase 3/4 functions be callable by anonymous users.
 */
const ALLOWED_FOR_SIGNED_IN = [
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
].sort();

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

const callable = async (role: string) =>
  (await rows<{ proname: string }>(db.admin,
    `select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
       and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.proname);

describe("function privileges", () => {
  it("anonymous visitors can execute NO function in the public schema", async () => {
    expect(await callable("anon")).toEqual([]);
  });
  it("signed-in users can execute exactly the allow-list (no internal helpers)", async () => {
    expect(await callable("authenticated")).toEqual(ALLOWED_FOR_SIGNED_IN);
  });
  it("the secret-key role can call exactly the four outbox functions and the first-admin bootstrap", async () => {
    expect(await callable("service_role")).toEqual(["admin_bootstrap_volunteer", "outbox_claim", "outbox_complete", "outbox_enqueue_reminders", "outbox_suppress"]);
  });
  it("internal helpers stay uncallable", async () => {
    const all = (await rows<{ proname: string }>(db.admin, "select distinct proname from pg_proc where pronamespace = 'public'::regnamespace")).map((r) => r.proname);
    const internal = all.filter((n) => !ALLOWED_FOR_SIGNED_IN.includes(n));
    expect(internal).toEqual(expect.arrayContaining(["_has_overlap", "_apply_template", "_enqueue", "missing_authorisations", "_fail"]));
  });
  it("a function created later does not become callable by anon (default privilege removed)", async () => {
    await db.admin.query("create function public.zz_probe() returns int language sql as 'select 1'");
    expect(await callable("anon")).toEqual([]);
    await db.admin.query("drop function public.zz_probe()");
  });
});
