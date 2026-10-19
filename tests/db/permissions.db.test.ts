import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, seedAssignment, venueId, type Person } from "./fixtures";

/**
 * Role-by-table permission tests. Every application table is listed so a new table
 * without a policy decision fails the "anon gets nothing" sweep.
 */
const ALL_TABLES = [
  "venues", "teams", "volunteers", "coordinator_venues", "duty_types", "volunteer_duty_authorisations",
  "duty_templates", "duty_template_items", "template_item_responsibilities", "events", "event_shifts",
  "event_shift_responsibilities", "assignments", "cancellation_requests", "notification_outbox", "audit_log", "club_settings",
];

let db: TestDb;
let mw: string, fw: string;
let admin: Person, coordMW: Person, alice: Person, bob: Person, suspended: Person;
let draftMW: string, draftFW: string, pubMW: string, pubFW: string;
let shiftPubMW: string, shiftDraftMW: string, shiftPubFW: string;
let aliceAssignment: string, bobAssignmentFW: string;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  admin = await person(db, "admin");
  coordMW = await makeCoordinator(db, [mw]);
  alice = await person(db, "volunteer", { name: "Alice" });
  bob = await person(db, "volunteer", { name: "Bob" });
  suspended = await person(db, "volunteer", { active: false });
  await db.admin.query("update volunteers set phone = '07700 900123' where id = $1", [bob.id]);

  draftMW = await makeEvent(db, { venue: mw, start: inHours(50), end: inHours(52), status: "draft", title: "Draft MW" });
  draftFW = await makeEvent(db, { venue: fw, start: inHours(50), end: inHours(52), status: "draft", title: "Draft FW" });
  pubMW = await makeEvent(db, { venue: mw, start: inHours(60), end: inHours(62), title: "Published MW" });
  pubFW = await makeEvent(db, { venue: fw, start: inHours(60), end: inHours(62), title: "Published FW" });
  shiftPubMW = await makeShift(db, { event: pubMW, duty: "cleaning", start: inHours(62), end: inHours(63), required: 3 });
  shiftDraftMW = await makeShift(db, { event: draftMW, duty: "cleaning", start: inHours(52), end: inHours(53) });
  shiftPubFW = await makeShift(db, { event: pubFW, duty: "cleaning", start: inHours(62), end: inHours(63) });
  aliceAssignment = await seedAssignment(db, shiftPubMW, alice.id, "confirmed");
  await seedAssignment(db, shiftPubMW, bob.id, "confirmed");
  bobAssignmentFW = await seedAssignment(db, shiftPubFW, bob.id, "confirmed");
});
afterAll(async () => db?.drop());

const sel = (who: Person, sql: string, p: unknown[] = []) => db.asUser(who.uid, (c) => rows<Record<string, unknown>>(c, sql, p));

describe("anonymous visitors", () => {
  it.each(ALL_TABLES)("anon cannot read %s", async (t) => {
    await expect(db.asAnon((c) => c.query(`select * from public.${t} limit 1`))).rejects.toThrow(/permission denied/);
  });
  it("anon cannot call any RPC", async () => {
    await expect(db.asAnon((c) => c.query("select public.self_signup($1)", [shiftPubMW]))).rejects.toThrow(/permission denied/);
    await expect(db.asAnon((c) => c.query("select * from public.event_roster($1)", [pubMW]))).rejects.toThrow(/permission denied/);
  });
  it("every application table has RLS enabled", async () => {
    const r = await rows<{ relname: string }>(db.admin,
      "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity");
    expect(r).toEqual([]);
  });
});

describe("suspended accounts", () => {
  it.each(["venues", "events", "event_shifts", "assignments", "duty_types", "club_settings", "volunteers"])(
    "a suspended volunteer reads nothing from %s",
    async (t) => {
      expect(await sel(suspended, `select * from public.${t}`)).toEqual([]);
    },
  );
});

describe("volunteers", () => {
  it("see published events at both venues, never drafts", async () => {
    const ids = (await sel(alice, "select id from events")).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([pubMW, pubFW]));
    expect(ids).not.toContain(draftMW);
    expect(ids).not.toContain(draftFW);
    expect(await sel(alice, "select id from event_shifts where id = $1", [shiftDraftMW])).toEqual([]);
  });

  it("see only their own assignments", async () => {
    const mine = await sel(alice, "select id, volunteer_id from assignments");
    expect(mine).toEqual([{ id: aliceAssignment, volunteer_id: alice.id }]);
  });

  it("cannot read anyone else's email or phone", async () => {
    expect(await sel(alice, "select email, phone from volunteers where id = $1", [bob.id])).toEqual([]);
  });

  it("roster shows NAMES only, and only on a published event they are on", async () => {
    const roster = await sel(alice, "select * from public.event_roster($1)", [pubMW]);
    expect(roster.map((r) => r.display_name).sort()).toEqual(["Alice", "Bob"]);
    expect(Object.keys(roster[0]).sort()).toEqual(["display_name", "shift_id"]);
    expect(await sel(alice, "select * from public.event_roster($1)", [pubFW])).toEqual([]); // not on it
  });

  it("staffing counts are visible but invited counts are hidden from volunteers", async () => {
    const [s] = await sel(alice, "select * from public.event_shift_staffing($1)", [pubMW]);
    expect(s).toMatchObject({ required_count: 3, confirmed_count: 2, open_slots: 1, invited_count: null, my_status: "confirmed" });
  });

  it.each([
    ["insert an assignment", "insert into assignments (shift_id, volunteer_id, status, source) values ($1, $2, 'confirmed', 'self_signup')"],
    ["update an assignment status", "update assignments set status = 'withdrawn' where shift_id = $1 and volunteer_id = $2"],
  ])("cannot %s directly", async (_n, sql) => {
    await expect(db.asUser(alice.uid, (c) => c.query(sql, [shiftPubMW, alice.id]))).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["events", "insert into events (venue_id, title, event_type, starts_at, ends_at) values ($1, 'x', 'fixture', now() + interval '1 day', now() + interval '2 days')"],
    ["event_shifts", "update event_shifts set instructions = 'x' where event_id = $1"],
    ["venues", "update venues set name = 'Hacked' where id = $1"],
    ["duty_types", "update duty_types set requires_authorisation = false where true and $1::uuid is not null"],
    ["club_settings", "update club_settings set withdrawal_cutoff_hours = 0 where $1::uuid is not null"],
  ])("cannot change %s", async (_t, sql) => {
    const arg = sql.includes("$1") ? [sql.includes("venues set") ? mw : sql.includes("insert into events") ? mw : pubMW] : [];
    const result = db.asUser(alice.uid, async (c) => (await c.query(sql, arg)).rowCount);
    await result.then((n) => expect(n).toBe(0), (e) => expect(String(e)).toMatch(/permission denied|row-level security/));
  });

  it("cannot read the audit log, the outbox, or others' authorisations", async () => {
    expect(await sel(alice, "select * from audit_log")).toEqual([]);
    await expect(sel(alice, "select * from notification_outbox")).rejects.toThrow(/permission denied/);
    expect(await sel(alice, "select * from volunteer_duty_authorisations where volunteer_id <> $1", [alice.id])).toEqual([]);
  });

  it("cannot see templates (organiser tool)", async () => {
    expect(await sel(alice, "select * from duty_templates")).toEqual([]);
  });

  it("cannot call organiser RPCs (forged calls fail)", async () => {
    await expectCode(rpc(db, alice, "allocate_volunteer", [shiftPubMW, bob.id]), "not_authorised");
    await expectCode(rpc(db, alice, "cancel_event", [pubMW, "x"]), "not_authorised");
    await expectCode(rpc(db, alice, "publish_event", [draftMW]), "not_authorised");
    await expectCode(rpc(db, alice, "remove_assignment", [bobAssignmentFW, "x"]), "not_authorised");
    expect(await sel(alice, "select * from public.volunteer_picker($1)", [shiftPubMW])).toEqual([]);
    expect(await sel(alice, "select * from public.event_site_coverage($1)", [pubMW])).toEqual([]);
  });

  it("cannot call internal helper functions", async () => {
    await expect(sel(alice, "select public._has_overlap($1, $2)", [alice.id, shiftPubMW])).rejects.toThrow(/permission denied/);
    await expect(sel(alice, "select public.missing_authorisations($1, $2)", [bob.id, shiftPubMW])).rejects.toThrow(/permission denied/);
  });
});

describe("coordinators (venue-scoped)", () => {
  it("see drafts at their venue only", async () => {
    const ids = (await sel(coordMW, "select id from events")).map((r) => r.id);
    expect(ids).toContain(draftMW);
    expect(ids).not.toContain(draftFW);
  });

  it("see all assignments at their venue, none elsewhere", async () => {
    const r = await sel(coordMW, "select shift_id from assignments");
    expect(r.every((x) => x.shift_id === shiftPubMW)).toBe(true);
    expect(r).toHaveLength(2);
  });

  it("see contact details only for volunteers assigned at their venue", async () => {
    const vis = (await sel(coordMW, "select id from volunteers")).map((r) => r.id);
    expect(vis).toEqual(expect.arrayContaining([alice.id, bob.id, coordMW.id]));
    const outsider = await person(db);
    expect(vis).not.toContain(outsider.id);
    expect(vis).not.toContain(admin.id);
  });

  // Since the Hub hardening migration, nobody writes events directly: all event changes go through
  // hub_create_event / hub_update_event / hub_set_event_status (tested in hub-calendar).
  it("cannot insert events directly at any venue", async () => {
    for (const v of [mw, fw]) {
      await expect(db.asUser(coordMW.uid, (c) =>
        c.query("insert into events (venue_id, title, event_type, starts_at, ends_at) values ($1, 'No', 'fixture', now() + interval '1 day', now() + interval '1 day 2 hours')", [v])))
        .rejects.toThrow(/permission denied/);
    }
  });

  it("cannot update events directly (title, times or status)", async () => {
    for (const sql of ["update events set title = 'x' where id = $1", "update events set starts_at = now() where id = $1", "update events set status = 'cancelled' where id = $1"]) {
      await expect(db.asUser(coordMW.uid, (c) => c.query(sql, [pubMW]))).rejects.toThrow(/permission denied/);
    }
  });

  it("cannot change roles, venue scopes, authorisations or templates", async () => {
    await expectCode(rpc(db, coordMW, "admin_set_volunteer_access", [coordMW.id, "admin", true]), "not_authorised");
    await expect(db.asUser(coordMW.uid, (c) => c.query("insert into coordinator_venues (volunteer_id, venue_id) values ($1, $2)", [coordMW.id, fw])))
      .rejects.toThrow(/row-level security/);
    await expect(db.asUser(coordMW.uid, (c) => c.query("insert into duty_templates (code, name, event_type) values ('TX', 'x', 'fixture')")))
      .rejects.toThrow(/row-level security/);
    expect(await sel(coordMW, "select * from audit_log")).toEqual([]);
  });

  it("allocate / cancel / coverage only at their venue", async () => {
    await expectCode(rpc(db, coordMW, "allocate_volunteer", [shiftPubFW, alice.id]), "not_authorised");
    await expectCode(rpc(db, coordMW, "cancel_event", [pubFW, "x"]), "not_authorised");
    expect(await sel(coordMW, "select * from public.event_site_coverage($1)", [pubFW])).toEqual([]);
    expect((await sel(coordMW, "select * from public.event_site_coverage($1)", [pubMW])).length).toBe(1);
  });
});

describe("admins", () => {
  it("see everything, including drafts at both venues and the audit log", async () => {
    const ids = (await sel(admin, "select id from events")).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([draftMW, draftFW, pubMW, pubFW]));
    expect((await sel(admin, "select count(*)::int as n from assignments"))[0].n).toBeGreaterThanOrEqual(3);
    expect((await sel(admin, "select count(*)::int as n from audit_log"))[0].n).toBeGreaterThan(0);
  });
  it("can manage venues, teams and coordinator scopes directly", async () => {
    await db.asUser(admin.uid, async (c) => {
      await c.query("insert into teams (name) values ('Reserves')");
      await c.query("update venues set address = 'Somewhere' where id = $1", [mw]);
      await c.query("insert into coordinator_venues (volunteer_id, venue_id) values ($1, $2)", [coordMW.id, fw]);
    });
  });
  it("still cannot read the outbox from the app (server worker only)", async () => {
    await expect(sel(admin, "select * from notification_outbox")).rejects.toThrow(/permission denied/);
  });
});

describe("own profile", () => {
  it("a volunteer can set their own phone and preferred venue, not their role", async () => {
    await db.asUser(alice.uid, (c) => c.query("update volunteers set phone = '07700 900000', preferred_venue_id = $2 where id = $1", [alice.id, fw]));
    await expect(db.asUser(alice.uid, (c) => c.query("update volunteers set role = 'admin' where id = $1", [alice.id]))).rejects.toThrow(/permission denied/);
  });
});
