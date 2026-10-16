import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { inHours, makeEvent, venueId } from "./fixtures";

const SEED = readFileSync(join(__dirname, "..", "..", "supabase", "seed.sql"), "utf8");

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

describe("dev-only DEMO seed", () => {
  it("loads cleanly; every event is flagged demo and labelled DEMO", async () => {
    await db.admin.query(SEED);
    const ev = await rows<{ title: string; is_demo: boolean }>(db.admin, "select title, is_demo from events");
    expect(ev.length).toBeGreaterThanOrEqual(6);
    expect(ev.every((e) => e.is_demo && e.title.startsWith("DEMO "))).toBe(true);
  });

  it("models shared venue cover without duplicate site leads, and overlapping events", async () => {
    const youth = await rows<{ code: string }>(db.admin,
      `select d.code from event_shifts s join duty_types d on d.id = s.duty_type_id join events e on e.id = s.event_id
       where e.title = 'DEMO U7/U9 youth fixture block' order by d.code`);
    expect(youth.map((r) => r.code)).toEqual(["cleaning", "pitch_setup"]);
    const firstTeam = await rows<{ n: number; slots: number }>(db.admin,
      `select count(*)::int as n, sum(required_count)::int as slots from event_shifts s join events e on e.id = s.event_id
       where e.title = 'DEMO First Team v Example Town'`);
    expect(firstTeam[0]).toEqual({ n: 5, slots: 8 });
  });

  it("refuses to load into a database that already has real (non-demo) events", async () => {
    const fresh = await createTestDb();
    try {
      await makeEvent(fresh, { venue: await venueId(fresh, "marke_wood"), start: inHours(10), end: inHours(12), title: "Real fixture" });
      await expect(fresh.admin.query(SEED)).rejects.toThrow(/Refusing to load DEMO data/);
    } finally {
      await fresh.drop();
    }
  });
});
