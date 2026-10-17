import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { authorise, expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, seedAssignment, venueId, type Person } from "./fixtures";

let db: TestDb;
let mw: string, fw: string;
let admin: Person, coordMW: Person, coordFW: Person, alice: Person, bob: Person;
let evMW: string, evFW: string, shiftMW: string, shiftFW: string, approvalShift: string;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  admin = await person(db, "admin");
  coordMW = await makeCoordinator(db, [mw]);
  coordFW = await makeCoordinator(db, [fw]);
  alice = await person(db, "volunteer", { name: "Alice" });
  bob = await person(db, "volunteer", { name: "Bob" });
  await db.admin.query("update volunteers set phone = '07700 900111' where id = $1", [alice.id]);

  evMW = await makeEvent(db, { venue: mw, start: inHours(100), end: inHours(102), title: "MW fixture" });
  shiftMW = await makeShift(db, { event: evMW, duty: "cleaning", start: inHours(102), end: inHours(103), required: 2 });
  approvalShift = await makeShift(db, { event: evMW, duty: "gate_admissions", start: inHours(99), end: inHours(100), approval: true });
  await makeShift(db, { event: evMW, duty: "pitch_setup", start: inHours(98), end: inHours(99) }); // nobody on it yet
  await seedAssignment(db, shiftMW, alice.id, "confirmed");
  evFW = await makeEvent(db, { venue: fw, start: inHours(100), end: inHours(102), title: "FW fixture" });
  shiftFW = await makeShift(db, { event: evFW, duty: "cleaning", start: inHours(102), end: inHours(103) });
  await seedAssignment(db, shiftFW, bob.id, "confirmed");
});
afterAll(async () => db?.drop());

type R = { event_title: string; duty_code: string; display_name: string | null; phone: string | null; status: string | null };
const roster = (who: Person, from = inHours(0), to = inHours(1000)) =>
  db.asUser(who.uid, (c) => rows<R>(c, "select * from public.manage_roster($1, $2)", [from, to]));

describe("manage_roster", () => {
  it("is venue-scoped: a coordinator sees only their venue's people", async () => {
    const r = await roster(coordMW);
    expect(new Set(r.map((x) => x.event_title))).toEqual(new Set(["MW fixture"]));
    expect(r.map((x) => x.display_name)).not.toContain("Bob");
  });
  it("includes phone for organisers (Q10), never email", async () => {
    const r = await roster(coordMW);
    expect(r.find((x) => x.display_name === "Alice")!.phone).toBe("07700 900111");
    expect(JSON.stringify(r)).not.toContain("@example.org");
  });
  it("lists empty duties once so a printed rota shows unfilled places", async () => {
    const r = await roster(coordMW);
    expect(r.filter((x) => x.duty_code === "pitch_setup")).toEqual([expect.objectContaining({ display_name: null, status: null })]);
  });
  it("admins see both venues; volunteers see nothing", async () => {
    expect(new Set((await roster(admin)).map((x) => x.event_title))).toEqual(new Set(["MW fixture", "FW fixture"]));
    expect(await roster(alice)).toEqual([]);
  });
  it("a single event can be requested, still scoped", async () => {
    const one = await db.asUser(coordFW.uid, (c) => rows(c, "select * from public.manage_roster(null, null, null, $1)", [evMW]));
    expect(one).toEqual([]);
  });
});

describe("manage_action_queue", () => {
  it("collects approvals, invitations and cancellation requests for the caller's venues only", async () => {
    const p = await person(db, "volunteer", { name: "Pat" });
    await rpc(db, p, "self_signup", [approvalShift]);                         // approval
    await rpc(db, coordMW, "allocate_volunteer", [shiftMW, bob.id]);         // invitation
    const soonEv = await makeEvent(db, { venue: mw, start: inHours(5), end: inHours(6), title: "Soon" });
    const soon = await makeShift(db, { event: soonEv, duty: "cleaning", start: inHours(6), end: inHours(7) });
    const a = await rpc<{ assignment_id: string }>(db, alice, "self_signup", [soon]);
    await rpc(db, alice, "request_cancellation", [a.assignment_id, "Ill"]);  // cancellation
    const q = await db.asUser(coordMW.uid, (c) => rows<{ kind: string; display_name: string; reason: string | null }>(c, "select kind, display_name, reason from public.manage_action_queue()"));
    expect(q.map((x) => x.kind)).toEqual(["cancellation", "approval", "invitation"]);
    expect(q[0]).toMatchObject({ display_name: "Alice", reason: "Ill" });
    expect(await db.asUser(coordFW.uid, (c) => rows(c, "select * from public.manage_action_queue()"))).toEqual([]);
    expect(await db.asUser(alice.uid, (c) => rows(c, "select * from public.manage_action_queue()"))).toEqual([]);
  });
});

describe("conflicts on allocation", () => {
  it("an invitation never reserves a place, and accepting a clashing invitation is refused", async () => {
    const c = await person(db, "volunteer", { name: "Clash" });
    const e1 = await makeEvent(db, { venue: mw, start: inHours(200), end: inHours(203) });
    const s1 = await makeShift(db, { event: e1, duty: "cleaning", start: inHours(200), end: inHours(203) });
    const e2 = await makeEvent(db, { venue: fw, start: inHours(201), end: inHours(202) });
    const s2 = await makeShift(db, { event: e2, duty: "cleaning", start: inHours(201), end: inHours(202) });
    await rpc(db, c, "self_signup", [s1]);
    const inv = await rpc<{ assignment_id: string }>(db, coordFW, "allocate_volunteer", [s2, c.id]);
    const [pick] = await db.asUser(coordFW.uid, (cl) => rows<{ has_overlap: boolean }>(cl, "select has_overlap from public.volunteer_picker($1) where volunteer_id = $2", [s2, c.id]));
    expect(pick.has_overlap).toBe(true); // picker warns the organiser
    await expectCode(rpc(db, c, "accept_invitation", [inv.assignment_id]), "overlap");
  });
});

describe("event_cover_leads", () => {
  it("names the confirmed lead on the linked cover event and flags lost authorisation", async () => {
    const lead = await person(db, "volunteer", { name: "Lee Lead" });
    for (const k of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, lead.id, k);
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(300), end: inHours(306) });
    const ls = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(300), end: inHours(306), responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
    await rpc(db, lead, "self_signup", [ls]);
    const fixture = await makeEvent(db, { venue: fw, start: inHours(301), end: inHours(303), coverageEventId: cover });
    const q = () => db.asUser(coordFW.uid, (c) => rows<{ source: string; display_name: string; status: string; authorised: boolean }>(c,
      "select source, display_name, status, authorised from public.event_cover_leads($1)", [fixture]));
    expect(await q()).toEqual([{ source: "linked_cover", display_name: "Lee Lead", status: "confirmed", authorised: true }]);
    await rpc(db, admin, "set_duty_authorisation", [lead.id, "open_unlock", false, null]);
    expect((await q())[0].authorised).toBe(false);
    expect(await db.asUser(coordMW.uid, (c) => rows(c, "select * from public.event_cover_leads($1)", [fixture]))).toEqual([]);
  });
});

describe("admin volunteer management", () => {
  it("only admins add volunteers; email is normalised; re-adding updates instead of duplicating", async () => {
    await expectCode(rpc(db, coordMW, "admin_create_volunteer", ["new@example.org", "New", "volunteer"]), "not_authorised");
    await expectCode(rpc(db, alice, "admin_create_volunteer", ["new@example.org", "New", "volunteer"]), "not_authorised");
    const r = await rpc<{ volunteer_id: string; existing: boolean }>(db, admin, "admin_create_volunteer", ["  New.Person@Example.org ", "New Person", "volunteer"]);
    expect(r.existing).toBe(false);
    const again = await rpc<{ volunteer_id: string; existing: boolean }>(db, admin, "admin_create_volunteer", ["new.person@example.org", "New P", "coordinator"]);
    expect(again).toMatchObject({ volunteer_id: r.volunteer_id, existing: true });
    const [row] = await rows<{ email: string; role: string; invited_at: Date | null }>(db.admin, "select email, role, invited_at from volunteers where id = $1", [r.volunteer_id]);
    expect(row).toMatchObject({ email: "new.person@example.org", role: "coordinator" });
    expect(row.invited_at).not.toBeNull();
    await expectCode(rpc(db, admin, "admin_create_volunteer", ["not-an-email", "X", "volunteer"]), "invalid_email");
  });

  it("re-inviting cannot demote the last admin", async () => {
    const solo = await createTestDb();
    try {
      const only = await person(solo, "admin");
      const [me] = await rows<{ email: string }>(solo.admin, "select email from volunteers where id = $1", [only.id]);
      await expectCode(rpc(solo, only, "admin_create_volunteer", [me.email, "Me", "volunteer"]), "last_admin");
    } finally {
      await solo.drop();
    }
  });

  it("coordinator venues are replaced atomically and only for coordinators", async () => {
    const c = await makeCoordinator(db, [mw]);
    await rpc(db, admin, "admin_set_coordinator_venues", [c.id, [fw]]);
    expect((await rows<{ venue_id: string }>(db.admin, "select venue_id from coordinator_venues where volunteer_id = $1", [c.id])).map((x) => x.venue_id)).toEqual([fw]);
    await expectCode(rpc(db, admin, "admin_set_coordinator_venues", [alice.id, [mw]]), "not_coordinator");
    await expectCode(rpc(db, coordMW, "admin_set_coordinator_venues", [coordMW.id, [mw, fw]]), "not_authorised");
  });
});

describe("losing the venue-wide lead alerts organisers of every linked event (Catalogue §7.8)", () => {
  async function world(base: number) {
    const lead = await person(db, "volunteer", { name: `Lead ${base}` });
    for (const k of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, lead.id, k);
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(base), end: inHours(base + 6) });
    const ls = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(base), end: inHours(base + 6), responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
    const a = await rpc<{ assignment_id: string }>(db, lead, "self_signup", [ls]);
    const f1 = await makeEvent(db, { venue: fw, start: inHours(base + 1), end: inHours(base + 3), coverageEventId: cover });
    const f2 = await makeEvent(db, { venue: fw, start: inHours(base + 3), end: inHours(base + 5), coverageEventId: cover });
    return { lead, a: a.assignment_id, f1, f2 };
  }
  const alertsFor = async (ids: string[]) =>
    (await rows<{ entity_id: string }>(db.admin, "select distinct entity_id from notification_outbox where kind = 'venue_cover_at_risk' and entity_id = any($1)", [ids])).map((r) => r.entity_id).sort();

  it("lead withdraws", async () => {
    const w = await world(2000);
    await rpc(db, w.lead, "withdraw_assignment", [w.a]);
    expect(await alertsFor([w.f1, w.f2])).toEqual([w.f1, w.f2].sort());
  });
  it("organiser removes the lead", async () => {
    const w = await world(2100);
    await rpc(db, coordFW, "remove_assignment", [w.a, "Unavailable"]);
    expect(await alertsFor([w.f1, w.f2])).toEqual([w.f1, w.f2].sort());
  });
  it("other duties changing do NOT raise venue alerts", async () => {
    const w = await world(2200);
    const helper = await person(db);
    const s = await makeShift(db, { event: w.f1, duty: "cleaning", start: inHours(2203), end: inHours(2204) });
    const h = await rpc<{ assignment_id: string }>(db, helper, "self_signup", [s]);
    await rpc(db, helper, "withdraw_assignment", [h.assignment_id]);
    expect(await alertsFor([w.f1, w.f2])).toEqual([]);
  });
});
