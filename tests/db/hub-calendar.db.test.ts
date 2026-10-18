import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, teamId, type HubUser } from "./hub-fixtures";

/** Stage 2 — unified calendar and minimal event entry. Times are UK wall-clock on a BST Saturday. */
let db: TestDb;
let admin: HubUser, coord: HubUser, teamCoord: HubUser, member: HubUser;
let marke: string, freemens: string, vets: string;
const SAT = "2026-10-24"; // BST (UTC+1)
const at = (hhmm: string, day = SAT) => new Date(`${day}T${hhmm}:00+01:00`).toISOString();

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin");
  coord = await hubUser(db, "coordinator");
  teamCoord = await hubUser(db, "coordinator");
  member = await hubUser(db, "member");
  [{ id: marke }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'marke_wood'");
  [{ id: freemens }] = await rows<{ id: string }>(db.admin, "select id from venues where code = 'freemens_way'");
  vets = await teamId(db, "Veterans (test)");
  await db.admin.query("insert into coordinator_scopes (person_id, venue_id) values ($1, $2)", [coord.id, marke]);
  await db.admin.query("insert into coordinator_scopes (person_id, team_id) values ($1, $2)", [teamCoord.id, vets]);
});
afterAll(async () => db?.drop());

const create = (who: HubUser, p: Record<string, unknown>) =>
  callCommit<{ id: string }>(db, who, "select public.hub_create_event($1::jsonb) id", [JSON.stringify(p)]).then((r) => r[0].id);
const outbox = async () => Number((await rows<{ n: string }>(db.admin, "select count(*) n from notification_outbox"))[0].n);

describe("C08–C10 — minimal events, overlaps, away fixtures", () => {
  let mini: string, youth: string, veterans: string, ladiesAway: string;
  it("C08: Mini Kickers 09:00–11:00, information-only, from five fields", async () => {
    const before = await outbox();
    mini = await create(admin, { title: "Mini Kickers", starts_at: at("09:00"), ends_at: at("11:00"), venue_id: marke, status: "published" });
    const [e] = await rows<Record<string, unknown>>(db.admin, "select volunteers_enabled, category, status, team_id from events where id = $1", [mini]);
    expect(e).toEqual({ volunteers_enabled: false, category: "other", status: "published", team_id: null });
    expect(await outbox()).toBe(before); // publishing sends nothing
  });
  it("C09: three overlapping Saturday events stay separate", async () => {
    youth = await create(admin, { title: "Youth Home Fixtures", category: "youth", starts_at: at("09:00"), ends_at: at("12:00"), venue_id: marke, status: "published" });
    veterans = await create(admin, { title: "Veterans v Test FC", category: "match", team_id: vets, starts_at: at("10:30"), kickoff_at: at("10:30"), venue_id: marke, status: "published" });
    const day = await call<{ id: string }>(db, member,
      "select id from events where starts_at >= $1 and starts_at < $2 order by starts_at, title", [at("00:00"), at("23:59")]);
    expect(day.map((d) => d.id).sort()).toEqual([mini, youth, veterans].sort());
  });
  it("C12: a kick-off-only event keeps an unknown finish (never invented)", async () => {
    const [v] = await rows<{ ends_at: Date | null; kickoff_at: Date }>(db.admin, "select ends_at, kickoff_at from events where id = $1", [veterans]);
    expect(v.ends_at).toBeNull();
    expect(v.kickoff_at.toISOString()).toBe(at("10:30"));
  });
  it("C10: an away fixture at a free-text location creates no venue and needs no volunteers", async () => {
    const venuesBefore = (await rows(db.admin, "select 1 from venues")).length;
    ladiesAway = await create(admin, { title: "Ladies away at Deal (test)", category: "match", starts_at: at("14:00", "2026-10-25"), external_location_text: "Charles Sports Ground, Deal", status: "published" });
    const [e] = await rows<Record<string, unknown>>(db.admin, "select venue_id, external_location_text, volunteers_enabled from events where id = $1", [ladiesAway]);
    expect(e).toEqual({ venue_id: null, external_location_text: "Charles Sports Ground, Deal", volunteers_enabled: false });
    expect((await rows(db.admin, "select 1 from venues")).length).toBe(venuesBefore);
  });
  it("needs a location, a start and a sensible finish", async () => {
    await expectCode(call(db, admin, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "X", starts_at: at("10:00") })]), "location_required");
    await expectCode(call(db, admin, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "X", venue_id: marke })]), "start_required");
    await expectCode(call(db, admin, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "X", venue_id: marke, starts_at: at("10:00"), ends_at: at("09:00") })]), "invalid_times");
    await expectCode(call(db, admin, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: " ", venue_id: marke, starts_at: at("10:00") })]), "title_required");
  });
});

describe("C11 — Freemens Way kept but inactive", () => {
  it("is stored inactive and refused for new events", async () => {
    const [v] = await rows<{ active: boolean; name: string }>(db.admin, "select active, name from venues where id = $1", [freemens]);
    expect(v).toEqual({ active: false, name: "Freemens Way" });
    await expectCode(call(db, admin, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "X", venue_id: freemens, starts_at: at("10:00") })]), "venue_inactive");
  });
  it("its historic events remain stored, viewable and editable without moving them", async () => {
    const [{ id }] = await rows<{ id: string }>(db.admin,
      "insert into events (venue_id, title, event_type, category, starts_at, ends_at, status) values ($1, 'Old Freemens fixture', 'fixture', 'match', $2, $3, 'completed') returning id",
      [freemens, at("10:00", "2026-03-07"), at("12:00", "2026-03-07")]);
    expect(await call(db, member, "select id from events where id = $1", [id])).toHaveLength(1);
    const [{ id: past }] = await rows<{ id: string }>(db.admin,
      "insert into events (venue_id, title, event_type, category, starts_at, ends_at, status) values ($1, 'Freemens draft', 'fixture', 'match', $2, $3, 'published') returning id",
      [freemens, at("10:00", "2026-11-07"), at("12:00", "2026-11-07")]);
    await callCommit(db, admin, "select public.hub_update_event($1, $2::jsonb)", [past, JSON.stringify({ title: "Freemens fixture (renamed)", venue_id: freemens, starts_at: at("10:00", "2026-11-07"), ends_at: at("12:00", "2026-11-07") })]);
    const [e] = await rows<{ title: string; venue_id: string }>(db.admin, "select title, venue_id from events where id = $1", [past]);
    expect(e).toEqual({ title: "Freemens fixture (renamed)", venue_id: freemens });
  });
});

describe("drafts, publishing, cancelling (C14 history part)", () => {
  it("members don't see drafts; publishing reveals them; nothing is sent", async () => {
    const before = await outbox();
    const id = await create(admin, { title: "Committee meeting", category: "meeting", starts_at: at("19:00", "2026-10-28"), external_location_text: "Clubhouse" });
    expect(await call(db, member, "select 1 from events where id = $1", [id])).toHaveLength(0);
    await callCommit(db, admin, "select public.hub_set_event_status($1, 'published')", [id]);
    expect(await call(db, member, "select 1 from events where id = $1", [id])).toHaveLength(1);
    expect(await outbox()).toBe(before);
  });
  it("cancelling needs a reason and keeps the event and its history", async () => {
    const id = await create(admin, { title: "Working party", category: "maintenance", starts_at: at("09:00", "2026-10-31"), ends_at: at("12:00", "2026-10-31"), venue_id: marke, status: "published" });
    await expectCode(call(db, admin, "select public.hub_set_event_status($1, 'cancelled', '')", [id]), "reason_required");
    await callCommit(db, admin, "select public.hub_set_event_status($1, 'cancelled', 'Pitch waterlogged')", [id]);
    const [e] = await rows<{ status: string; cancel_reason: string }>(db.admin, "select status, cancel_reason from events where id = $1", [id]);
    expect(e).toEqual({ status: "cancelled", cancel_reason: "Pitch waterlogged" });
    expect(await call(db, member, "select 1 from events where id = $1", [id])).toHaveLength(1);
    await expectCode(call(db, admin, "select public.hub_update_event($1, $2::jsonb)", [id, JSON.stringify({ title: "x", venue_id: marke, starts_at: at("09:00", "2026-10-31") })]), "invalid_transition");
    const audit = await rows(db.admin, "select 1 from audit_log where entity_type = 'events' and entity_id = $1", [id]);
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
  it("reports a material change (date/time/venue) but not a title change", async () => {
    const id = await create(admin, { title: "Training", category: "training", starts_at: at("18:00", "2026-10-29"), ends_at: at("19:30", "2026-10-29"), venue_id: marke });
    const base = { title: "Training", category: "training", starts_at: at("18:00", "2026-10-29"), ends_at: at("19:30", "2026-10-29"), venue_id: marke };
    const [a] = await callCommit<{ r: { material: boolean } }>(db, admin, "select public.hub_update_event($1, $2::jsonb) r", [id, JSON.stringify({ ...base, title: "Training (U12)" })]);
    expect(a.r.material).toBe(false);
    const [b] = await callCommit<{ r: { material: boolean } }>(db, admin, "select public.hub_update_event($1, $2::jsonb) r", [id, JSON.stringify({ ...base, starts_at: at("18:30", "2026-10-29") })]);
    expect(b.r.material).toBe(true);
  });
});

describe("organiser scope", () => {
  it("a venue coordinator can add at their venue; a team coordinator for their team anywhere", async () => {
    await create(coord, { title: "Coord event", starts_at: at("09:00", "2026-11-01"), venue_id: marke });
    await create(teamCoord, { title: "Vets away", team_id: vets, starts_at: at("10:30", "2026-11-01"), external_location_text: "Away ground" });
    await expectCode(call(db, teamCoord, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "Not mine", venue_id: marke, starts_at: at("09:00", "2026-11-02") })]), "not_authorised");
  });
  it("members can't create, edit or publish; anonymous visitors see nothing", async () => {
    await expectCode(call(db, member, "select public.hub_create_event($1::jsonb)", [JSON.stringify({ title: "X", venue_id: marke, starts_at: at("09:00") })]), "not_authorised");
    const [{ id }] = await rows<{ id: string }>(db.admin, "select id from events limit 1");
    await expectCode(call(db, member, "select public.hub_set_event_status($1, 'cancelled', 'x')", [id]), "not_authorised");
    await expect(call(db, member, "update events set title = 'x' where id = $1", [id])).resolves.toEqual([]);
    expect((await rows<{ title: string }>(db.admin, "select title from events where id = $1", [id]))[0].title).not.toBe("x");
    await expect(db.asAnon((c) => c.query("select * from events"))).rejects.toThrow(/permission denied/);
  });
});

describe("C51 (part) — existing events are kept with their ids", () => {
  it("a legacy fixture and its shifts survive the migration and become a 'match'", async () => {
    let legacyId = "";
    const staged = await createTestDb({
      pauseBefore: "20261019000200",
      atPause: async (a) => {
        const [{ id: v }] = (await a.query<{ id: string }>("select id from venues where code = 'marke_wood'")).rows;
        legacyId = (await a.query<{ id: string }>(
          "insert into events (venue_id, title, event_type, starts_at, ends_at, status) values ($1, 'Reserves v Test (legacy)', 'fixture', '2026-10-31 12:30+00', '2026-10-31 16:30+00', 'published') returning id", [v])).rows[0].id;
        const [{ id: duty }] = (await a.query<{ id: string }>("select id from duty_types where code = 'refreshments'")).rows;
        await a.query("insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values ($1, $2, '2026-10-31 12:00+00', '2026-10-31 16:00+00', 2)", [legacyId, duty]);
      },
    });
    try {
      const [e] = await rows<Record<string, unknown>>(staged.admin, "select title, category, status, volunteers_enabled from events where id = $1", [legacyId]);
      expect(e).toEqual({ title: "Reserves v Test (legacy)", category: "match", status: "published", volunteers_enabled: false });
      expect(await rows(staged.admin, "select 1 from event_shifts where event_id = $1", [legacyId])).toHaveLength(1);
    } finally {
      await staged.drop();
    }
  });
});

describe("rollback script for Stage 2", () => {
  it("refuses while Hub-only events exist, and works once they're resolved", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("docs/sql/rollback-20261019000200.sql", "utf8");
    const scratch = await createTestDb({ stopBefore: "20261019000300" });
    try {
      const [{ id: v }] = await rows<{ id: string }>(scratch.admin, "select id from venues where code = 'marke_wood'");
      await scratch.admin.query("insert into events (title, category, starts_at, external_location_text) values ('Away', 'match', now(), 'Deal')");
      await expect(scratch.admin.query(`begin; ${sql}; commit;`)).rejects.toThrow(/rollback_blocked/);
      await scratch.admin.query("rollback").catch(() => {});
      await scratch.admin.query("update events set venue_id = $1, ends_at = starts_at + interval '2 hours'", [v]);
      await scratch.admin.query(`begin; ${sql}; commit;`);
      const [fw] = await rows<{ active: boolean }>(scratch.admin, "select active from venues where code = 'freemens_way'");
      expect(fw.active).toBe(true);
      expect(await rows(scratch.admin, "select 1 from information_schema.columns where table_name = 'events' and column_name = 'category'")).toHaveLength(0);
    } finally {
      await scratch.drop();
    }
  });
});
