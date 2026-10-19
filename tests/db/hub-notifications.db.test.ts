import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, type HubUser } from "./hub-fixtures";

/** Stage 7 — Hub email through the outbox: explicit actions only, idempotent, re-checked, recipient-safe. */
let db: TestDb;
let admin: HubUser, kelly: HubUser, bob: HubUser;
let marke: string, ev: string;
const D = (days: number, h: number) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
const outbox = () => rows<{ kind: string; status: string; recipient_person_id: string; payload: Record<string, unknown>; error: string | null; dedupe_key: string }>(
  db.admin, "select kind, status, recipient_person_id, payload, error, dedupe_key from notification_outbox order by created_at, kind");
const claim = () => db.asService(async (c) => (await c.query("select * from public.outbox_claim(50)")).rows as { id: string; kind: string; recipient_email: string; payload: Record<string, unknown> }[]);

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  kelly = await hubUser(db, "member", "Kelly (demo)");
  bob = await hubUser(db, "member", "Bob (demo)");
  [{ id: marke }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'marke_wood'");
});
afterAll(async () => db?.drop());

describe("C50 — only deliberate actions queue messages", () => {
  it("creating people, events and applications queues nothing", async () => {
    await callCommit(db, admin, "select public.hub_create_person($1::jsonb)", [JSON.stringify({ full_name: "Quiet Person", email: "quiet@example.org", routine_requests_enabled: true })]);
    [{ id: ev }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id",
      [JSON.stringify({ title: "Ladies v Test", starts_at: D(4, 13), ends_at: D(4, 16), venue_id: marke, volunteers_enabled: true, status: "published" })]);
    await db.asService((c) => c.query("select public.public_submit_application($1::jsonb, 'rate-key-0123456789abcdef')", [JSON.stringify({
      full_name: "App Licant", email: "app@example.org", contact_preference: "email", is_adult: true, unsure_role: true,
      commitment_bucket: "varies", commitment_pattern: "unsure", work_location_preference: "either", privacy_acknowledged: true, privacy_notice_version: "v1" })]));
    expect(await outbox()).toEqual([]);
  });
  it("an explicit availability request queues one message per asked person with a login — not for others", async () => {
    const pat = await plainPerson(db, "Pat no login", { email_normalized: "pat@example.org" });
    await callCommit(db, admin, "select public.hub_request_availability($1, $2)", [ev, [kelly.id, pat]]);
    const o = await outbox();
    expect(o.map((x) => [x.kind, x.recipient_person_id])).toEqual([["availability_request", kelly.id]]);
    const req = await rows<{ person_id: string; delivery_state: string }>(db.admin, "select person_id, delivery_state from availability_requests where event_id = $1 order by delivery_state", [ev]);
    expect(Object.fromEntries(req.map((r) => [r.person_id, r.delivery_state]))).toEqual({ [kelly.id]: "queued", [pat]: "not_sent" });
  });
  it("payloads describe only the recipient's own request — no other people", async () => {
    const [o] = await outbox();
    expect(Object.keys(o.payload).sort()).toEqual(["demo", "duty", "event_id", "event_title", "person_name", "request_id", "shift_ends_at", "shift_starts_at", "venue"].sort());
    expect(JSON.stringify(o.payload)).not.toMatch(/@|\+44/);
  });
});

describe("H52 — release switch, idempotency, re-check before sending", () => {
  it("nothing is handed out while email is held (the default)", async () => {
    expect(await claim()).toEqual([]);
  });
  it("after an admin starts email, a message whose request was already answered is not sent", async () => {
    await callCommit(db, admin, "select public.admin_set_email_release('include_current')");
    await callCommit(db, kelly, "select public.hub_respond_availability($1, 'yes', true)", [ev]);
    expect(await claim()).toEqual([]);
    const [o] = await outbox();
    expect(o).toMatchObject({ status: "suppressed", error: "already_replied" });
  });
  it("an invitation is sent once, to the right person, and a retry can't duplicate it", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string } }>(db, admin, "select public.hub_invite_to_help($1, $2, 'Matchday support') r", [ev, bob.id]);
    const first = await claim();
    expect(first.map((m) => [m.kind, m.recipient_email])).toEqual([["assignment_request", bob.email]]);
    expect(await claim()).toEqual([]); // claimed once
    // Same action again: idempotent at the source…
    await callCommit(db, admin, "select public.hub_invite_to_help($1, $2, 'Matchday support')", [ev, bob.id]);
    expect((await outbox()).filter((x) => x.kind === "assignment_request")).toHaveLength(1);
    // …and a failed send retries with back-off, still one row, same idempotency key.
    const st = await db.asService(async (c) => (await c.query("select public.outbox_complete($1, false, 'timeout to bob@x.org', null, true) s", [first[0].id])).rows[0].s);
    expect(st).toBe("pending");
    const [row] = (await outbox()).filter((x) => x.kind === "assignment_request");
    expect(row.error).toBe("timeout to [email]"); // no addresses stored
    expect(row.dedupe_key).toBe(`assignment_request:${r.assignment_id}`);
  });
  it("answering the invitation makes the pending invitation obsolete and tells the organiser", async () => {
    const [{ id }] = await rows<{ id: string }>(db.admin, "select id from hub_assignments where person_id = $1", [bob.id]);
    await db.admin.query("update notification_outbox set send_after = now() where kind = 'assignment_request'");
    await callCommit(db, bob, "select public.hub_respond_assignment($1, true)", [id]);
    const m = await claim();
    expect(m.map((x) => x.kind)).toEqual(["assignment_confirmed"]);
    expect(m[0].recipient_email).toBe(admin.email);
    expect(m[0].payload.person_name).toBe("Bob (demo)");
    const req = (await outbox()).find((x) => x.kind === "assignment_request")!;
    expect(req).toMatchObject({ status: "suppressed", error: "already_answered" });
  });
});

describe("C14 — reconfirmation and cancellation messages; reminders", () => {
  it("a material change asks the confirmed person to reconfirm; cancelling the event tells them and stops reminders", async () => {
    const base = { title: "Ladies v Test", starts_at: D(4, 13), ends_at: D(4, 16), venue_id: marke, volunteers_enabled: true };
    await callCommit(db, admin, "select public.hub_update_event($1, $2::jsonb)", [ev, JSON.stringify({ ...base, starts_at: D(4, 14), ends_at: D(4, 17) })]);
    expect((await claim()).map((x) => x.kind)).toEqual(["assignment_reconfirm"]);
    await callCommit(db, admin, "select public.hub_set_event_status($1, 'cancelled', 'Pitch closed')", [ev]);
    expect((await claim()).map((x) => x.kind)).toEqual(["hub_event_cancelled"]);
  });
  it("day-before reminders cover confirmed Hub commitments once, in UK time", async () => {
    // "Tomorrow" in UK time (not UTC), 13:00–15:00 local.
    const [{ s: ts, e: te }] = await rows<{ s: Date; e: Date }>(db.admin,
      "select (((now() at time zone 'Europe/London')::date + 1) + time '13:00') at time zone 'Europe/London' s, (((now() at time zone 'Europe/London')::date + 1) + time '15:00') at time zone 'Europe/London' e");
    const [{ id: tmr }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id",
      [JSON.stringify({ title: "Tomorrow match", starts_at: ts.toISOString(), ends_at: te.toISOString(), venue_id: marke, status: "published" })]);
    await callCommit(db, admin, "select public.hub_invite_to_help($1, $2, 'Gate', null, null, 'record_confirmed')", [tmr, kelly.id]);
    const n1 = await db.asService(async (c) => (await c.query("select public.outbox_enqueue_reminders() n")).rows[0].n);
    const n2 = await db.asService(async (c) => (await c.query("select public.outbox_enqueue_reminders() n")).rows[0].n);
    expect([n1, n2]).toEqual([1, 0]);
    expect((await outbox()).filter((x) => x.kind === "hub_reminder").map((x) => x.recipient_person_id)).toEqual([kelly.id]);
  });
  it("demo events never send", async () => {
    const [{ id }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id",
      [JSON.stringify({ title: "Demo", starts_at: D(6, 12), venue_id: marke, status: "published", volunteers_enabled: true })]);
    await db.admin.query("update events set is_demo = true where id = $1", [id]);
    await callCommit(db, admin, "select public.hub_request_availability($1, $2)", [id, [bob.id]]);
    expect((await outbox()).filter((x) => x.payload.event_id === id).every((x) => x.status === "suppressed")).toBe(true);
  });
});

describe("settings and privacy", () => {
  it("admins save the club contact, application switch and retention; others can't", async () => {
    await callCommit(db, admin, "select public.hub_save_settings($1::jsonb)", [JSON.stringify({ contact_email: "Secretary@Club.example", applications_open: false, application_retention_months: "12", reminder_day_before: true })]);
    const [s] = await rows<Record<string, unknown>>(db.admin, "select contact_email, applications_open, application_retention_months from club_settings");
    expect(s).toEqual({ contact_email: "secretary@club.example", applications_open: false, application_retention_months: 12 });
    await expectCode(call(db, kelly, "select public.hub_save_settings('{}'::jsonb)"), "not_authorised");
  });
  it("anonymising a leaver removes their details but keeps event history; nothing more is sent to them", async () => {
    await callCommit(db, admin, "select public.hub_anonymise_person($1)", [bob.id]);
    const [p] = await rows<Record<string, unknown>>(db.admin, "select full_name, email_normalized, phone_normalized, lifecycle_status from people where id = $1", [bob.id]);
    expect(p).toEqual({ full_name: "Former volunteer", email_normalized: null, phone_normalized: null, lifecycle_status: "inactive" });
    expect(await rows(db.admin, "select 1 from hub_assignments where person_id = $1", [bob.id])).not.toHaveLength(0);
    expect((await rows<{ enabled: boolean; auth_user_id: string | null }>(db.admin, "select enabled, auth_user_id from user_accounts where person_id = $1", [bob.id]))[0]).toEqual({ enabled: false, auth_user_id: null });
    expect(await rows(db.admin, "select 1 from notification_outbox where recipient_person_id = $1 and status = 'pending'", [bob.id])).toHaveLength(0);
    const audit = await rows<{ new_data: unknown }>(db.admin, "select new_data from audit_log where entity_id = $1 and action = 'person_anonymised'", [bob.id]);
    expect(audit).toHaveLength(1);
    await expectCode(call(db, admin, "select public.hub_anonymise_person($1)", [admin.id]), "self_lockout");
  });
});
