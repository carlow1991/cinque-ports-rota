import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { call, callCommit, hubUser, plainPerson, type HubUser } from "./hub-fixtures";

/** Findings from the independent security review (Stage 7), pinned as regressions. */
let db: TestDb;
let a: HubUser, b: HubUser, coord: HubUser, member: HubUser;
let minor: string, eventId: string;

/** Give a Hub person the legacy volunteers row they'd have if migrated (same id). */
async function legacyRow(u: HubUser, role: "admin" | "coordinator" | "volunteer") {
  await db.admin.query(
    "insert into volunteers (id, email, display_name, role, invited_at, auth_user_id, linked_at) values ($1, $2, 'Legacy', $3, now(), $4, now())",
    [u.id, u.email, role, u.uid]);
}

beforeAll(async () => {
  db = await createTestDb();
  a = await hubUser(db, "admin", "Admin A");
  b = await hubUser(db, "admin", "Admin B");
  coord = await hubUser(db, "coordinator", "Coord");
  member = await hubUser(db, "member", "Member M");
  await legacyRow(a, "admin");
  await legacyRow(coord, "coordinator");
  await db.admin.query("update people set notes_private = 'ADMIN-ONLY NOTE' where id = $1", [member.id]);
  minor = await plainPerson(db, "Junior J", { is_under_18: true, directory_visibility: "private" });
  const [{ id: mw }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'marke_wood'");
  await db.admin.query("insert into coordinator_venues (volunteer_id, venue_id) values ($1, $2)", [coord.id, mw]);
  [{ id: eventId }] = await rows<{ id: string }>(db.admin,
    "insert into events (venue_id, title, starts_at, ends_at, status, volunteers_enabled) values ($1, 'Hardening test', now() + interval '2 days', now() + interval '2 days 2 hours', 'published', true) returning id", [mw]);
  await db.admin.query("insert into event_availability (event_id, person_id, response, for_full_event, response_source, recorded_by_person_id) values ($1, $2, 'yes', true, 'admin_recorded', $3)", [eventId, minor, b.id]);
});
afterAll(async () => db?.drop());

describe("legacy permissions follow the Hub account", () => {
  it("an enabled Hub admin with a legacy row keeps legacy admin", async () => {
    const [r] = await call<{ ok: boolean }>(db, a, "select public.is_admin() ok");
    expect(r.ok).toBe(true);
  });
  it("disabling someone in the Hub removes their legacy admin powers and contact access", async () => {
    await callCommit(db, b, "select public.hub_set_access($1, 'member', false)", [a.id]);
    const [r] = await call<{ legacy: boolean; vid: string | null }>(db, a, "select public.is_admin() legacy, public.current_volunteer_id() vid");
    expect(r).toEqual({ legacy: false, vid: null });
    // At most their own legacy row (own-row policy); never anyone else's contact details.
    const seen = await call<{ id: string }>(db, a, "select id from volunteers");
    expect(seen.every((r) => r.id === a.id)).toBe(true);
    expect(await call(db, a, "select 1 from audit_log")).toEqual([]);
    await expect(call(db, a, "select public.admin_set_email_release('include_current')")).rejects.toThrow();
  });
  it("demoting in the Hub demotes the legacy role too", async () => {
    await callCommit(db, b, "select public.hub_set_access($1, 'member', true)", [coord.id]);
    const [r] = await call<{ role: string }>(db, coord, "select public.current_app_role()::text role");
    expect(r.role).toBe("volunteer");
    await callCommit(db, b, "select public.hub_set_access($1, 'coordinator', true)", [coord.id]);
  });
  it("events can't be inserted or updated directly (only through the Hub functions)", async () => {
    await expect(call(db, coord, "update events set title = 'Changed' where id = $1", [eventId])).rejects.toThrow(/permission denied/);
    await expect(call(db, coord, "insert into events (title, starts_at, status) values ('x', now(), 'draft')")).rejects.toThrow(/permission denied/);
  });
});

describe("admin-only notes", () => {
  it("a member can read their own record but not the admin's notes about them", async () => {
    expect(await call(db, member, "select full_name from people where id = $1", [member.id])).toEqual([{ full_name: "Member M" }]);
    await expect(call(db, member, "select notes_private from people where id = $1", [member.id])).rejects.toThrow(/permission denied/);
    await expect(call(db, member, "select note_private from position_interests")).rejects.toThrow(/permission denied/);
    await expect(call(db, member, "select note_private from position_holders")).rejects.toThrow(/permission denied/);
    await expect(call(db, member, "select public.hub_person_notes($1)", [member.id])).rejects.toThrow();
  });
  it("an administrator reads them through hub_person_notes", async () => {
    expect(await call(db, b, "select public.hub_person_notes($1) n", [member.id])).toEqual([{ n: "ADMIN-ONLY NOTE" }]);
  });
});

describe("under-18s", () => {
  it("are not offered to coordinators in the people picker (administrators still see them)", async () => {
    const forCoord = await call<{ person_id: string }>(db, coord, "select person_id from public.hub_people_picker()");
    expect(forCoord.map((r) => r.person_id)).not.toContain(minor);
    const forAdmin = await call<{ person_id: string }>(db, b, "select person_id from public.hub_people_picker()");
    expect(forAdmin.map((r) => r.person_id)).toContain(minor);
  });
  it("are not named to ordinary members on event pages; organisers still see them", async () => {
    const [m] = await call<{ r: { availability: { person_id: string }[] } }>(db, member, "select public.hub_event_involvement($1) r", [eventId]);
    expect(m.r.availability.map((x) => x.person_id)).not.toContain(minor);
    const [o] = await call<{ r: { availability: { person_id: string }[] } }>(db, b, "select public.hub_event_involvement($1) r", [eventId]);
    expect(o.r.availability.map((x) => x.person_id)).toContain(minor);
  });
  it("the unfiltered inner function can't be called directly", async () => {
    await expect(call(db, member, "select public._hub_event_involvement_all($1)", [eventId])).rejects.toThrow(/permission denied/);
  });
});

describe("rollback script for the hardening migration", () => {
  it("applies cleanly and restores the previous behaviour", async () => {
    const scratch = await createTestDb();
    try {
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000800.sql", "utf8")}; commit;`);
      const m = await hubUser(scratch, "member");
      await scratch.asUser(m.uid, (c) => c.query("select notes_private from people"));
      expect(await rows(scratch.admin, "select 1 from pg_proc where proname = '_hub_event_involvement_all'")).toEqual([]);
      expect(await rows(scratch.admin, "select 1 from pg_policies where policyname = 'events_manager_update'")).toHaveLength(1);
    } finally {
      await scratch.drop();
    }
  });
});
