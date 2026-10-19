import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, teamId, type HubUser } from "./hub-fixtures";

/** Stage 3 — availability replies, explicit requests, direct invitations, expected by role. Demo names only. */
let db: TestDb;
let admin: HubUser, kelly: HubUser, bob: HubUser, steve: HubUser, adam: HubUser, riley: HubUser, outsider: HubUser;
let scott: string, danny: string, matty: string, noLogin: string;
let marke: string, ladies: string;
let youthEvent: string, ladiesEvent: string, infoEvent: string, kickoffOnly: string;

const D = (offsetDays: number, hhmm: string) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const [h, m] = hhmm.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
};
const create = async (p: Record<string, unknown>) =>
  (await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id", [JSON.stringify({ status: "published", ...p })]))[0].id;

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  kelly = await hubUser(db, "member", "Kelly (demo)");
  bob = await hubUser(db, "member", "Bob (demo)");
  steve = await hubUser(db, "member", "Steve (demo)");
  adam = await hubUser(db, "member", "Adam (demo)");
  riley = await hubUser(db, "member", "Riley (demo)");
  outsider = await hubUser(db, "member", "Unasked Member");
  for (const u of [kelly, bob, steve, adam, riley]) await db.admin.query("update people set routine_requests_enabled = true where id = $1", [u.id]);
  scott = await plainPerson(db, "Scott (demo)", { involvement: "{manager}" });
  danny = await plainPerson(db, "Danny (demo)", { involvement: "{manager}" });
  matty = await plainPerson(db, "Matty (demo)", { involvement: "{manager}" });
  noLogin = await plainPerson(db, "Phone-only Pat", { phone_normalized: "+447700900222" });
  [{ id: marke }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'marke_wood'");
  ladies = await teamId(db, "Ladies (test)");
  await db.admin.query("insert into team_people (team_id, person_id, role_label, is_expected_by_default, active_from) values ($1, $2, 'Manager', true, '2026-01-01')", [ladies, scott]);
  youthEvent = await create({ title: "Youth Home Fixtures", category: "youth", starts_at: D(5, "08:00"), ends_at: D(5, "11:00"), venue_id: marke, volunteers_enabled: true });
  ladiesEvent = await create({ title: "Ladies v Test", category: "match", team_id: ladies, starts_at: D(6, "13:00"), ends_at: D(6, "16:00"), venue_id: marke, volunteers_enabled: true });
  infoEvent = await create({ title: "Committee meeting", category: "meeting", starts_at: D(7, "18:00"), external_location_text: "Clubhouse" });
  kickoffOnly = await create({ title: "Veterans", category: "match", starts_at: D(5, "09:30"), kickoff_at: D(5, "09:30"), venue_id: marke, volunteers_enabled: true });
});
afterAll(async () => db?.drop());

const outbox = async () => Number((await rows<{ n: string }>(db.admin, "select count(*) n from notification_outbox"))[0].n);
const respond = (who: HubUser, ev: string, resp: string, full = true, from: string | null = null, until: string | null = null) =>
  callCommit(db, who, "select public.hub_respond_availability($1, $2, $3, $4, $5) r", [ev, resp, full, from, until]);

describe("C16 / C17 — Yes/No replies", () => {
  it("C16: Yes → whole event saves one reply; changing to No updates it and the change is audited", async () => {
    await respond(kelly, youthEvent, "yes", true);
    await respond(kelly, youthEvent, "no");
    const r = await rows<{ response: string; for_full_event: boolean }>(db.admin, "select response, for_full_event from event_availability where event_id = $1 and person_id = $2", [youthEvent, kelly.id]);
    expect(r).toEqual([{ response: "no", for_full_event: false }]);
    const audit = await rows<{ action: string }>(db.admin, "select action from audit_log where entity_type = 'event_availability' order by id");
    expect(audit.map((a) => a.action)).toEqual(["insert", "update"]);
  });
  it("C17: specific times are saved; invalid or outside times are refused", async () => {
    await respond(kelly, youthEvent, "yes", false, D(5, "09:00"), D(5, "11:00"));
    const [r] = await rows<Record<string, unknown>>(db.admin, "select for_full_event, needs_admin_check from event_availability where event_id = $1 and person_id = $2", [youthEvent, kelly.id]);
    expect(r).toEqual({ for_full_event: false, needs_admin_check: false });
    await expectCode(respond(kelly, youthEvent, "yes", false, D(5, "10:00"), D(5, "09:00")), "invalid_times");
    await expectCode(respond(kelly, youthEvent, "yes", false, D(5, "12:00"), D(5, "15:00")), "outside_event");
    await expectCode(respond(kelly, youthEvent, "yes", false, null, null), "times_required");
  });
  it("C17: with no recorded finish, partial times are kept but flagged for an organiser", async () => {
    const [r] = await respond(adam, kickoffOnly, "yes", false, D(5, "09:00"), D(5, "11:30")) as { r: { needs_admin_check: boolean } }[];
    expect(r.r.needs_admin_check).toBe(true);
  });
  it("an information-only event never accepts replies", async () => {
    await expectCode(respond(kelly, infoEvent, "yes"), "volunteers_not_enabled");
  });
  it("a reply never creates an assignment", async () => {
    expect(await rows(db.admin, "select 1 from hub_assignments where person_id = $1", [kelly.id])).toHaveLength(0);
  });
});

describe("C18 / C19 — only people deliberately asked are 'Not replied'", () => {
  it("C19: requesting Kelly, Adam, Riley, Bob and Steve leaves the managers unrequested", async () => {
    const before = await outbox();
    const [res] = await callCommit<{ r: { requested: number } }>(db, admin, "select public.hub_request_availability($1, $2) r",
      [ladiesEvent, [kelly.id, adam.id, riley.id, bob.id, steve.id]]);
    expect(res.r.requested).toBe(5);
    const asked = await rows<{ person_id: string }>(db.admin, "select person_id from availability_requests where event_id = $1", [ladiesEvent]);
    expect(asked.map((a) => a.person_id).sort()).toEqual([kelly.id, adam.id, riley.id, bob.id, steve.id].sort());
    for (const m of [scott, danny, matty]) expect(asked.map((a) => a.person_id)).not.toContain(m);
    // One message per person asked (all five have Hub logins) — queued only by this explicit Send.
    expect(await outbox()).toBe(before + 5);
  });
  it("asking again is idempotent (no duplicate request)", async () => {
    const [res] = await callCommit<{ r: { requested: number; already_asked: number } }>(db, admin, "select public.hub_request_availability($1, $2) r", [ladiesEvent, [kelly.id, kelly.id]]);
    expect(res.r).toEqual({ requested: 0, already_asked: 1 });
  });
  it("C18: the involvement view shows requests; someone never asked isn't listed as 'not replied'", async () => {
    await respond(adam, ladiesEvent, "yes");
    const [{ r }] = await call<{ r: { requests: { person_id: string; replied: boolean }[] } }>(db, admin, "select public.hub_event_involvement($1) r", [ladiesEvent]);
    expect(r.requests.filter((x) => !x.replied).map((x) => x.person_id).sort()).toEqual([kelly.id, riley.id, bob.id, steve.id].sort());
    expect(r.requests.map((x) => x.person_id)).not.toContain(outsider.id);
  });
  it("candidate picker pre-ticks routine people only, and never under-18s", async () => {
    const minor = await plainPerson(db, "Minor Mo", { is_under_18: true, directory_visibility: "private" });
    const c = await call<{ person_id: string; suggested: boolean }>(db, admin, "select * from hub_request_candidates($1)", [ladiesEvent]);
    expect(c.find((x) => x.person_id === scott)!.suggested).toBe(false);
    expect(c.find((x) => x.person_id === kelly.id)!.suggested).toBe(true);
    expect(c.map((x) => x.person_id)).not.toContain(minor);
  });
  it("requests need a published event that asks for volunteers", async () => {
    await expectCode(call(db, admin, "select public.hub_request_availability($1, $2)", [infoEvent, [kelly.id]]), "volunteers_not_enabled");
  });
  it("Home shows a member only the requests they were sent and haven't answered", async () => {
    const [{ r }] = await call<{ r: { requests: { event_id: string }[] } }>(db, riley, "select public.hub_my_home() r");
    expect(r.requests.map((x) => x.event_id)).toEqual([ladiesEvent]);
    const [{ r: a }] = await call<{ r: { requests: unknown[] } }>(db, adam, "select public.hub_my_home() r");
    expect(a.requests).toHaveLength(0); // Adam already replied
  });
});

describe("C20 / C21 / C24 / H25 — direct invitations", () => {
  let bobA: string, steveA: string;
  it("C20: Bob is invited (pending, NOT confirmed), even though he said yes to availability", async () => {
    await respond(bob, ladiesEvent, "yes");
    const [{ r }] = await callCommit<{ r: { assignment_id: string; status: string } }>(db, admin,
      "select public.hub_invite_to_help($1, $2, 'Matchday support', null, null, 'request') r", [ladiesEvent, bob.id]);
    bobA = r.assignment_id;
    expect(r.status).toBe("pending");
  });
  it("H25: a double click doesn't create a second invitation", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string; status: string } }>(db, admin,
      "select public.hub_invite_to_help($1, $2, 'matchday support', null, null, 'request') r", [ladiesEvent, bob.id]);
    expect(r).toMatchObject({ assignment_id: bobA, status: "already_pending" });
    expect(await rows(db.admin, "select 1 from hub_assignments where person_id = $1", [bob.id])).toHaveLength(1);
  });
  it("C20: only when Bob accepts is he confirmed (by himself); accepting twice stays one confirmation", async () => {
    await callCommit(db, bob, "select public.hub_respond_assignment($1, true)", [bobA]);
    await callCommit(db, bob, "select public.hub_respond_assignment($1, true)", [bobA]);
    const [a] = await rows<{ state: string; response_source: string }>(db.admin, "select state, response_source from hub_assignments where id = $1", [bobA]);
    expect(a).toEqual({ state: "confirmed", response_source: "self" });
  });
  it("C21: Steve declines; Bob's confirmation and the event are unchanged", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string } }>(db, admin, "select public.hub_invite_to_help($1, $2, 'Matchday support') r", [ladiesEvent, steve.id]);
    steveA = r.assignment_id;
    await callCommit(db, steve, "select public.hub_respond_assignment($1, false)", [steveA]);
    const states = await rows<{ id: string; state: string }>(db.admin, "select id, state from hub_assignments where event_id = $1", [ladiesEvent]);
    expect(Object.fromEntries(states.map((s) => [s.id, s.state]))).toEqual({ [bobA]: "confirmed", [steveA]: "declined" });
    // …and the organiser can ask someone else
    const [{ r: r2 }] = await callCommit<{ r: { status: string } }>(db, admin, "select public.hub_invite_to_help($1, $2, 'Matchday support') r", [ladiesEvent, riley.id]);
    expect(r2.status).toBe("pending");
  });
  it("only the invited person can answer their invitation (no IDOR)", async () => {
    await expectCode(call(db, kelly, "select public.hub_respond_assignment($1, true)", [steveA]), "not_found");
    const [{ id }] = await rows<{ id: string }>(db.admin, "select id from hub_assignments where person_id = $1 and state = 'pending'", [riley.id]);
    await expectCode(call(db, kelly, "select public.hub_respond_assignment($1, true)", [id]), "not_found");
    expect(await call(db, kelly, "select * from hub_assignments")).toHaveLength(0);
  });
  it("C24: a manager with routine requests OFF can still be invited by an explicit one-off action", async () => {
    const [{ r }] = await callCommit<{ r: { status: string; has_account: boolean } }>(db, admin, "select public.hub_invite_to_help($1, $2, 'Linesman') r", [youthEvent, danny]);
    expect(r).toMatchObject({ status: "pending", has_account: false });
  });
  it("C22: an organiser records an offline yes for someone without a login — attributed, not 'confirmed online'", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string } }>(db, admin, "select public.hub_invite_to_help($1, $2, 'Tea bar', null, null, 'record_confirmed') r", [youthEvent, noLogin]);
    const [a] = await rows<Record<string, unknown>>(db.admin, "select state, response_source, recorded_by_person_id, invitation_source from hub_assignments where id = $1", [r.assignment_id]);
    expect(a).toEqual({ state: "confirmed", response_source: "admin_recorded", recorded_by_person_id: admin.id, invitation_source: "offline" });
    await callCommit(db, admin, "select public.hub_record_availability($1, $2, 'yes', true)", [youthEvent, noLogin]);
    const [av] = await rows<Record<string, unknown>>(db.admin, "select response_source, recorded_by_person_id from event_availability where event_id = $1 and person_id = $2", [youthEvent, noLogin]);
    expect(av).toEqual({ response_source: "admin_recorded", recorded_by_person_id: admin.id });
  });
  it("a confirmation can't be written without saying who confirmed it", async () => {
    await expect(db.admin.query("insert into hub_assignments (person_id, scope, event_id, state, invitation_source) values ($1, 'event', $2, 'confirmed', 'portal')", [kelly.id, infoEvent]))
      .rejects.toThrow(/confirmation_attributed/);
  });
});

describe("C23 — expected by role", () => {
  it("Scott is Expected at Ladies events, never confirmed, without being asked", async () => {
    const [{ r }] = await call<{ r: { expected: { person_id: string; override: string | null }[]; assignments: { person_id: string }[] } }>(db, kelly, "select public.hub_event_involvement($1) r", [ladiesEvent]);
    expect(r.expected.map((x) => x.person_id)).toEqual([scott]);
    expect(r.assignments.map((x) => x.person_id)).not.toContain(scott);
    expect(await rows(db.admin, "select 1 from availability_requests where person_id = $1", [scott])).toHaveLength(0);
  });
  it("a one-off absence affects only that event, not the team role", async () => {
    const other = await create({ title: "Ladies v Other", category: "match", team_id: ladies, starts_at: D(13, "13:00"), ends_at: D(13, "15:00"), venue_id: marke });
    await callCommit(db, admin, "select public.hub_set_expected_override($1, $2, 'not_expected', 'On holiday')", [ladiesEvent, scott]);
    const [{ r: m }] = await call<{ r: { expected: unknown[] } }>(db, kelly, "select public.hub_event_involvement($1) r", [ladiesEvent]);
    expect(m.expected).toHaveLength(0); // members no longer see him as expected
    const [{ r: o }] = await call<{ r: { expected: { person_id: string }[] } }>(db, kelly, "select public.hub_event_involvement($1) r", [other]);
    expect(o.expected.map((x) => x.person_id)).toEqual([scott]);
    const [tp] = await rows<{ is_expected_by_default: boolean; active_to: string | null }>(db.admin, "select is_expected_by_default, active_to from team_people where person_id = $1", [scott]);
    expect(tp).toEqual({ is_expected_by_default: true, active_to: null });
  });
  it("members don't see contact details in the involvement view; organisers do", async () => {
    const [{ r }] = await call<{ r: { assignments: { phone: string | null }[] } }>(db, kelly, "select public.hub_event_involvement($1) r", [youthEvent]);
    expect(r.assignments.every((a) => a.phone === null)).toBe(true);
    const [{ r: ad }] = await call<{ r: { assignments: { person_id: string; phone: string | null }[] } }>(db, admin, "select public.hub_event_involvement($1) r", [youthEvent]);
    expect(ad.assignments.find((a) => a.person_id === noLogin)!.phone).toBe("+447700900222");
  });
});

describe("C14 — material changes and cancellations", () => {
  it("rescheduling flags confirmed people to reconfirm; a title change doesn't", async () => {
    const base = { title: "Ladies v Test", category: "match", team_id: ladies, starts_at: D(6, "13:00"), ends_at: D(6, "16:00"), venue_id: marke, volunteers_enabled: true };
    const [{ r: t }] = await callCommit<{ r: { material: boolean; reconfirm: number } }>(db, admin, "select public.hub_update_event($1, $2::jsonb) r", [ladiesEvent, JSON.stringify({ ...base, title: "Ladies v Test FC" })]);
    expect(t).toEqual({ material: false, reconfirm: 0 });
    const [{ r }] = await callCommit<{ r: { material: boolean; reconfirm: number } }>(db, admin, "select public.hub_update_event($1, $2::jsonb) r", [ladiesEvent, JSON.stringify({ ...base, starts_at: D(6, "14:00"), ends_at: D(6, "17:00") })]);
    expect(r).toEqual({ material: true, reconfirm: 1 });
    const [bobRow] = await rows<{ state: string }>(db.admin, "select state from hub_assignments where event_id = $1 and person_id = $2", [ladiesEvent, bob.id]);
    expect(bobRow.state).toBe("needs_reconfirmation");
    await callCommit(db, bob, "select public.hub_respond_assignment(id, true) from hub_assignments where event_id = $1 and person_id = $2", [ladiesEvent, bob.id]);
    const [again] = await rows<{ state: string }>(db.admin, "select state from hub_assignments where event_id = $1 and person_id = $2", [ladiesEvent, bob.id]);
    expect(again.state).toBe("confirmed");
  });
  it("cancelling the event closes open requests and keeps the history", async () => {
    await callCommit(db, admin, "select public.hub_set_event_status($1, 'cancelled', 'Rained off')", [youthEvent]);
    const states = await rows<{ state: string; cancel_reason: string }>(db.admin, "select state, cancel_reason from hub_assignments where event_id = $1", [youthEvent]);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s.state === "cancelled" && s.cancel_reason === "The event was cancelled")).toBe(true);
    await expectCode(respond(kelly, youthEvent, "yes"), "event_not_open");
    expect(await rows(db.admin, "select 1 from event_availability where event_id = $1", [youthEvent])).not.toHaveLength(0);
  });
});

describe("security", () => {
  it("members can't record for others, request availability or invite", async () => {
    await expectCode(call(db, kelly, "select public.hub_record_availability($1, $2, 'yes')", [ladiesEvent, bob.id]), "not_authorised");
    await expectCode(call(db, kelly, "select public.hub_request_availability($1, $2)", [ladiesEvent, [bob.id]]), "not_authorised");
    await expectCode(call(db, kelly, "select public.hub_invite_to_help($1, $2)", [ladiesEvent, bob.id]), "not_authorised");
  });
  it("members see only their own replies and requests in the tables", async () => {
    const seen = await call<{ person_id: string }>(db, kelly, "select person_id from event_availability");
    expect(new Set(seen.map((s) => s.person_id))).toEqual(new Set([kelly.id]));
    const req = await call<{ person_id: string }>(db, kelly, "select person_id from availability_requests");
    expect(new Set(req.map((s) => s.person_id))).toEqual(new Set([kelly.id]));
  });
  it("anonymous visitors can't read any of it", async () => {
    for (const t of ["availability_requests", "event_availability", "hub_assignments", "event_participation_exceptions"]) {
      await expect(db.asAnon((c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe("rollback script for Stage 3", () => {
  it("applies cleanly; events can still be edited afterwards", async () => {
    const { readFileSync } = await import("node:fs");
    const scratch = await createTestDb({ stopBefore: "20261019000400" });
    try {
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000300.sql", "utf8")}; commit;`);
      expect(await rows(scratch.admin, "select 1 from pg_tables where tablename in ('hub_assignments','event_availability')")).toHaveLength(0);
      const a = await (await import("./hub-fixtures")).hubUser(scratch, "admin");
      const [{ id: v }] = await rows<{ id: string }>(scratch.admin, "select id from venues where code = 'marke_wood'");
      const p = { title: "After rollback", starts_at: new Date(Date.now() + 86_400_000).toISOString(), venue_id: v };
      const [{ id }] = await scratch.asUserCommit(a.uid, async (c) => (await c.query("select public.hub_create_event($1::jsonb) id", [JSON.stringify(p)])).rows);
      await scratch.asUserCommit(a.uid, (c) => c.query("select public.hub_update_event($1, $2::jsonb)", [id, JSON.stringify({ ...p, title: "Renamed" })]));
    } finally {
      await scratch.drop();
    }
  });
});
