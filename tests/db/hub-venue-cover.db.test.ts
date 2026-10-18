import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, teamId, type HubUser } from "./hub-fixtures";

/** Stage 4 — shared venue cover, derived event context, conflicts and unique headcounts. Demo data only. */
let db: TestDb;
let admin: HubUser, kelly: HubUser, member: HubUser;
let marke: string, park: string, vets: string, scott: string;
let mini: string, youth: string, veterans: string, parkEvent: string;
let cover: string;

// A Saturday ~10 days ahead, in UTC hours (UK date chosen far from a clock change in tests' lifetime is not
// guaranteed, so everything is expressed as absolute instants relative to one base).
const base = new Date(Date.now() + 10 * 86_400_000); base.setUTCHours(0, 0, 0, 0);
const H = (h: number, m = 0) => new Date(base.getTime() + (h * 60 + m) * 60_000).toISOString();

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  kelly = await hubUser(db, "member", "Kelly (demo)");
  member = await hubUser(db, "member", "Mo Member");
  [{ id: marke }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'marke_wood'");
  [{ id: park }] = await rows<{ id: string }>(db.admin, "insert into venues (code, name, short_name) values ('test_park', 'Test Park', 'Park') returning id");
  vets = await teamId(db, "Veterans (test)");
  scott = await plainPerson(db, "Scott (demo)");
  await db.admin.query("insert into team_people (team_id, person_id, role_label, is_expected_by_default, active_from) values ($1, $2, 'Manager', true, '2026-01-01')", [vets, scott]);
  const ev = async (p: Record<string, unknown>) =>
    (await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id", [JSON.stringify({ status: "published", ...p })]))[0].id;
  mini = await ev({ title: "Mini Kickers", starts_at: H(9), ends_at: H(11), venue_id: marke });
  youth = await ev({ title: "Youth Home Fixtures", starts_at: H(9), ends_at: H(12), venue_id: marke, volunteers_enabled: true });
  veterans = await ev({ title: "Veterans", team_id: vets, starts_at: H(10, 30), ends_at: H(13), venue_id: marke });
  parkEvent = await ev({ title: "Park event", starts_at: H(10), ends_at: H(12), venue_id: park });
});
afterAll(async () => db?.drop());

const coverOf = async (eventId: string, who: HubUser = member) =>
  (await call<{ r: { venue_cover: { person_id: string; coverage: string }[] } }>(db, who, "select public.hub_event_involvement($1) r", [eventId]))[0].r.venue_cover;

describe("C26 / C27 — one café assignment covers three overlapping events", () => {
  it("is stored ONCE and appears as cover on Mini Kickers, Youth and Veterans", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string } }>(db, admin,
      "select public.hub_create_venue_cover($1, $2, $3, $4, 'Café', 'request') r", [marke, kelly.id, H(9), H(13)]);
    cover = r.assignment_id;
    // pending: not yet shown as cover anywhere
    expect(await coverOf(mini)).toEqual([]);
    await callCommit(db, kelly, "select public.hub_respond_assignment($1, true)", [cover]);
    for (const e of [mini, youth, veterans]) {
      const c = await coverOf(e);
      expect(c.map((x) => x.person_id)).toEqual([kelly.id]);
      expect(c[0].coverage).toBe("full");
    }
    expect(await rows(db.admin, "select 1 from hub_assignments where person_id = $1", [kelly.id])).toHaveLength(1);
    expect(await rows(db.admin, "select 1 from hub_assignments where scope = 'event'")).toHaveLength(0); // no clones
  });
  it("C27: the day summary counts Kelly once; per-event counts don't double her", async () => {
    const [{ r }] = await call<{ r: { days: { people: number }[]; events: { id: string; counts: { confirmed: number } }[] } }>(db, admin,
      "select public.hub_manage_overview($1, $2) r", [H(0), H(24)]);
    expect(r.days).toEqual([{ day: expect.any(String), people: 1 }]);
    for (const id of [mini, youth, veterans]) expect(r.events.find((e) => e.id === id)!.counts.confirmed).toBe(1);
    // and Kelly also said "yes" to Youth and has an event assignment there: still one person
    await callCommit(db, kelly, "select public.hub_respond_availability($1, 'yes', true)", [youth]);
    const [{ r: again }] = await call<{ r: { events: { id: string; counts: { confirmed: number; available: number } }[] } }>(db, admin, "select public.hub_manage_overview($1, $2) r", [H(0), H(24)]);
    expect(again.events.find((e) => e.id === youth)!.counts).toMatchObject({ confirmed: 1, available: 0 });
  });
  it("members see the cover in the day list with no contact details; 'also supports' is derived", async () => {
    const [{ r }] = await call<{ r: { id: string; events: number; phone: string | null; name: string }[] }>(db, member, "select public.hub_venue_covers($1, $2) r", [H(0), H(24)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: cover, events: 3, phone: null, name: "Kelly (demo)" });
  });
});

describe("C28 — changing or cancelling the one record updates every event", () => {
  it("ending at 11:00 makes Youth and Veterans partial and keeps Mini Kickers full", async () => {
    await callCommit(db, admin, "select public.hub_update_venue_cover($1, $2, $3, 'Café', true)", [cover, H(9), H(11)]);
    expect((await coverOf(mini))[0].coverage).toBe("full");
    expect((await coverOf(youth))[0].coverage).toBe("partial");
    expect((await coverOf(veterans))[0].coverage).toBe("partial");
    const [a] = await rows<{ state: string; response_source: string }>(db.admin, "select state, response_source from hub_assignments where id = $1", [cover]);
    expect(a).toEqual({ state: "confirmed", response_source: "admin_recorded" }); // organiser recorded that Kelly agreed
  });
  it("a time change without recorded agreement needs Kelly to reconfirm (and stops counting as cover)", async () => {
    await callCommit(db, admin, "select public.hub_update_venue_cover($1, $2, $3, 'Café', false)", [cover, H(9), H(12)]);
    expect(await coverOf(mini)).toEqual([]);
    await callCommit(db, kelly, "select public.hub_respond_assignment($1, true)", [cover]);
    expect((await coverOf(mini))[0].coverage).toBe("full");
  });
  it("cancelling removes it from all derived views at once", async () => {
    const [{ r }] = await callCommit<{ r: { assignment_id: string } }>(db, admin,
      "select public.hub_create_venue_cover($1, $2, $3, $4, 'Opening', 'record_confirmed') r", [marke, member.id, H(8), H(9, 30)]);
    expect((await coverOf(mini)).map((c) => c.person_id).sort()).toEqual([kelly.id, member.id].sort());
    await callCommit(db, admin, "select public.hub_cancel_assignment($1, 'Not needed')", [r.assignment_id]);
    expect((await coverOf(mini)).map((c) => c.person_id)).toEqual([kelly.id]);
  });
});

describe("C29 / C31 — venue boundaries and unknown finishes", () => {
  it("C29: cover at Marke Wood never appears on an event at another venue", async () => {
    expect(await coverOf(parkEvent)).toEqual([]);
  });
  it("C31: an event with no recorded finish only gets 'cover at kick-off', never the whole event", async () => {
    const [{ id }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id",
      [JSON.stringify({ title: "Vets kick-off only", starts_at: H(10, 30), kickoff_at: H(10, 30), venue_id: marke, status: "published" })]);
    expect((await coverOf(id))[0].coverage).toBe("at_start_only");
    const [{ id: late }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_event($1::jsonb) id",
      [JSON.stringify({ title: "Starts after cover", starts_at: H(12, 30), venue_id: marke, status: "published" })]);
    expect(await coverOf(late)).toEqual([]);
  });
});

describe("C30 / H32 — conflicts only for genuinely different places", () => {
  it("same-venue cover across concurrent events is accepted", async () => {
    const [{ r }] = await callCommit<{ r: { conflicts: unknown[] } }>(db, admin,
      "select public.hub_invite_to_help($1, $2, 'Gate', $3, $4, 'record_confirmed') r", [veterans, kelly.id, H(10, 30), H(12)]);
    expect(r.conflicts).toEqual([]);
  });
  it("needing Kelly at Test Park at the same time is refused without a note, accepted with one", async () => {
    await expectCode(call(db, admin, "select public.hub_create_venue_cover($1, $2, $3, $4, 'Café')", [park, kelly.id, H(10), H(11)]), "conflict");
    await expectCode(call(db, admin, "select public.hub_invite_to_help($1, $2, 'Gate')", [parkEvent, kelly.id]), "conflict");
    const [{ r }] = await callCommit<{ r: { conflicts: unknown[] } }>(db, admin,
      "select public.hub_create_venue_cover($1, $2, $3, $4, 'Café', 'request', 'Covering both by golf buggy (demo)') r", [park, kelly.id, H(10), H(11)]);
    expect(r.conflicts.length).toBeGreaterThan(0);
    const [a] = await rows<{ conflict_override_note: string }>(db.admin, "select conflict_override_note from hub_assignments where venue_id = $1", [park]);
    expect(a.conflict_override_note).toMatch(/golf buggy/);
  });
  it("the preview lists overlapping events and clashes before saving", async () => {
    const [{ r }] = await call<{ r: { events: { id: string; coverage: string }[]; conflicts: unknown[] } }>(db, admin,
      "select public.hub_venue_cover_preview($1, $2, $3, $4) r", [marke, H(9), H(11), member.id]);
    expect(r.events.map((e) => e.id)).toEqual(expect.arrayContaining([mini, youth, veterans]));
    expect(r.conflicts).toEqual([]);
  });
  it("H32: unlock and lock are two clean venue assignments for different people", async () => {
    const opener = await plainPerson(db, "Opener (demo)");
    const closer = await plainPerson(db, "Closer (demo)");
    await callCommit(db, admin, "select public.hub_create_venue_cover($1, $2, $3, $4, 'Open and unlock facilities', 'record_confirmed')", [marke, opener, H(8), H(8, 45)]);
    await callCommit(db, admin, "select public.hub_create_venue_cover($1, $2, $3, $4, 'Lock and secure facilities', 'record_confirmed')", [marke, closer, H(13), H(13, 45)]);
    const n = await rows(db.admin, "select 1 from hub_assignments where scope = 'venue' and person_id in ($1, $2)", [opener, closer]);
    expect(n).toHaveLength(2);
    expect(await rows(db.admin, "select 1 from hub_assignments where scope = 'event' and person_id in ($1, $2)", [opener, closer])).toHaveLength(0);
  });
  it("creating the same cover twice returns the existing one (double click)", async () => {
    const args = [marke, member.id, H(14), H(15)];
    const [{ r: a }] = await callCommit<{ r: { assignment_id: string } }>(db, admin, "select public.hub_create_venue_cover($1, $2, $3, $4, 'Café', 'request') r", args);
    const [{ r: b }] = await callCommit<{ r: { assignment_id: string; status: string } }>(db, admin, "select public.hub_create_venue_cover($1, $2, $3, $4, 'Café', 'request') r", args);
    expect(b).toMatchObject({ assignment_id: a.assignment_id, status: "already_exists" });
  });
});

describe("permissions", () => {
  it("members can't create, change or see other people's pending cover", async () => {
    await expectCode(call(db, member, "select public.hub_create_venue_cover($1, $2, $3, $4)", [marke, member.id, H(16), H(17)]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_update_venue_cover($1, $2, $3, 'x')", [cover, H(9), H(10)]), "not_authorised");
    const [{ r }] = await call<{ r: { state: string; person_id: string }[] }>(db, member, "select public.hub_venue_covers($1, $2) r", [H(0), H(24)]);
    expect(r.every((c) => c.state === "confirmed" || c.person_id === member.id)).toBe(true);
    await expectCode(call(db, member, "select public.hub_manage_overview($1, $2)", [H(0), H(24)]), "not_authorised");
  });
  it("a venue coordinator can't arrange cover at another venue", async () => {
    const coord = await hubUser(db, "coordinator");
    await db.admin.query("insert into coordinator_scopes (person_id, venue_id) values ($1, $2)", [coord.id, park]);
    await expectCode(call(db, coord, "select public.hub_create_venue_cover($1, $2, $3, $4)", [marke, member.id, H(16), H(17)]), "not_authorised");
  });
});

describe("rollback script for Stage 4", () => {
  it("applies cleanly and Stage 3 invitations still work", async () => {
    const { readFileSync } = await import("node:fs");
    const scratch = await createTestDb({ stopBefore: "20261019000500" });
    try {
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000400.sql", "utf8")}; commit;`);
      const a = await hubUser(scratch, "admin");
      const m = await hubUser(scratch, "member");
      const [{ id: v }] = await rows<{ id: string }>(scratch.admin, "select id from venues where code = 'marke_wood'");
      const p = { title: "After rollback", starts_at: new Date(Date.now() + 86_400_000).toISOString(), venue_id: v, status: "published" };
      const [{ id }] = await scratch.asUserCommit(a.uid, async (c) => (await c.query("select public.hub_create_event($1::jsonb) id", [JSON.stringify(p)])).rows);
      await scratch.asUserCommit(a.uid, (c) => c.query("select public.hub_invite_to_help($1, $2, 'Gate')", [id, m.id]));
      await scratch.asUser(m.uid, (c) => c.query("select public.hub_event_involvement($1)", [id]));
    } finally {
      await scratch.drop();
    }
  });
});
