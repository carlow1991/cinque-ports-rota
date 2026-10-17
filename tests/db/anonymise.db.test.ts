import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { authorise, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, venueId, type Person } from "./fixtures";

/** Runs the exact procedure from docs/sql/anonymise-volunteer.sql (privacy guide). */
const SQL = readFileSync(join(__dirname, "..", "..", "docs", "sql", "anonymise-volunteer.sql"), "utf8");
const forEmail = (email: string) => {
  expect(SQL).toContain("'person@example.org'");
  return SQL.replace("'person@example.org'", `'${email.replace(/'/g, "''")}'`);
};

let db: TestDb;
let mw: string;
let admin: Person;
beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  admin = await person(db, "admin");
});
afterAll(async () => db?.drop());

describe("anonymising a former volunteer", () => {
  it("removes name, phone, email and reasons everywhere, keeps the duty history, and suspends the account", async () => {
    const leaver = await person(db, "volunteer", { name: "Zebedee Unique-Leaver" });
    await db.admin.query("update volunteers set phone = '07700 900555', preferred_venue_id = $2 where id = $1", [leaver.id, mw]);
    await authorise(db, leaver.id, "site_lead");
    // A past duty they did, a duty they were removed from with a reason, and a late cancellation request.
    const past = await makeEvent(db, { venue: mw, start: inHours(-50), end: inHours(-48), status: "completed" });
    const ps = await makeShift(db, { event: past, duty: "cleaning", start: inHours(-50), end: inHours(-48) });
    await db.admin.query("insert into assignments (shift_id, volunteer_id, status, source) values ($1, $2, 'confirmed', 'self_signup')", [ps, leaver.id]);
    const e = await makeEvent(db, { venue: mw, start: inHours(30), end: inHours(32) });
    const s1 = await makeShift(db, { event: e, duty: "cleaning", start: inHours(30), end: inHours(31), required: 3 });
    const s2 = await makeShift(db, { event: e, duty: "refreshments", start: inHours(31), end: inHours(32), required: 3 });
    const a1 = await rpc<{ assignment_id: string }>(db, leaver, "self_signup", [s1]);
    const a2 = await rpc<{ assignment_id: string }>(db, leaver, "self_signup", [s2]);
    await db.admin.query("update club_settings set withdrawal_cutoff_hours = 48");
    await rpc(db, leaver, "request_cancellation", [a2.assignment_id, "Zebedee's knee operation"]);
    await rpc(db, admin, "remove_assignment", [a1.assignment_id, "Zebedee moving away"]);
    await rpc(db, admin, "remove_assignment", [a2.assignment_id, "Zebedee moving away"]);
    await db.admin.query("update club_settings set withdrawal_cutoff_hours = 24");

    await db.admin.query(forEmail(leaver.email.toUpperCase()));

    const [v] = await rows<Record<string, unknown>>(db.admin, "select display_name, phone, email::text, is_active, auth_user_id, preferred_venue_id, role from volunteers where id = $1", [leaver.id]);
    expect(v).toEqual({ display_name: "Former volunteer", phone: null, email: `removed+${leaver.id}@invalid.example`, is_active: false, auth_user_id: null, preferred_venue_id: null, role: "volunteer" });
    expect(await rows(db.admin, "select 1 from volunteer_duty_authorisations where volunteer_id = $1", [leaver.id])).toEqual([]);
    // Past duty kept for the club's records.
    expect((await rows(db.admin, "select 1 from assignments where volunteer_id = $1 and shift_id = $2", [leaver.id, ps])).length).toBe(1);
    // No trace of the name, phone, email or reasons anywhere in the database.
    const dump = await rows<{ t: string }>(db.admin, `
      select row_to_json(x)::text t from volunteers x union all select row_to_json(x)::text from audit_log x
      union all select row_to_json(x)::text from assignments x union all select row_to_json(x)::text from cancellation_requests x
      union all select row_to_json(x)::text from notification_outbox x`);
    const all = dump.map((r) => r.t).join("\n");
    expect(all).not.toMatch(/Zebedee|900555/);
    expect(all.toLowerCase()).not.toContain(leaver.email.toLowerCase());
  });

  it("refuses while the person still has an upcoming duty, or is the last admin, or isn't found", async () => {
    const busy = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(60), end: inHours(62) });
    const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(60), end: inHours(62) });
    await rpc(db, busy, "self_signup", [s]);
    await expect(db.admin.query(forEmail(busy.email))).rejects.toThrow(/upcoming duties/);
    await expect(db.admin.query(forEmail("nobody@nowhere.example"))).rejects.toThrow(/No volunteer/);
    // Make `admin` the only admin left, then try.
    await db.admin.query("update volunteers set is_active = false where role = 'admin' and id <> $1", [admin.id]);
    await expect(db.admin.query(forEmail(admin.email))).rejects.toThrow(/last active administrator/);
    const [still] = await rows<{ display_name: string }>(db.admin, "select display_name from volunteers where id = $1", [busy.id]);
    expect(still.display_name).not.toBe("Former volunteer");
  });

  it("a coordinator's venue access is removed too", async () => {
    const c = await makeCoordinator(db, [mw]);
    await db.admin.query(forEmail(c.email));
    expect(await rows(db.admin, "select 1 from coordinator_venues where volunteer_id = $1", [c.id])).toEqual([]);
  });
});

describe("routine retention clean-up (docs/sql/retention-cleanup.sql)", () => {
  it("removes only finished emails older than 90 days and audit older than 24 months", async () => {
    const clean = readFileSync(join(__dirname, "..", "..", "docs", "sql", "retention-cleanup.sql"), "utf8");
    const v = await person(db);
    const mk = (key: string, status: string, ageDays: number) => db.admin.query(
      `insert into notification_outbox (recipient_volunteer_id, kind, entity_type, entity_id, dedupe_key, payload, status, created_at)
       values ($1, 'signup_confirmed', 'assignments', gen_random_uuid(), $2, '{}', $3, now() - make_interval(days => $4))`, [v.id, key, status, ageDays]);
    await mk("ret:old-sent", "sent", 100);
    await mk("ret:old-pending", "pending", 100);
    await mk("ret:new-sent", "sent", 10);
    await db.admin.query("insert into audit_log (action, entity_type, created_at) values ('UPDATE', 'ret-old', now() - interval '25 months'), ('UPDATE', 'ret-new', now() - interval '23 months')");
    const events = (await rows<{ n: number }>(db.admin, "select count(*)::int n from events"))[0].n;
    await db.admin.query(clean);
    const left = (await rows<{ dedupe_key: string }>(db.admin, "select dedupe_key from notification_outbox where dedupe_key like 'ret:%' order by 1")).map((r) => r.dedupe_key);
    expect(left).toEqual(["ret:new-sent", "ret:old-pending"]);
    expect((await rows<{ entity_type: string }>(db.admin, "select entity_type from audit_log where entity_type like 'ret-%'")).map((r) => r.entity_type)).toEqual(["ret-new"]);
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int n from events"))[0].n).toBe(events);
  });
});
