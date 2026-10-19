import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";

const SEED = readFileSync(join(__dirname, "..", "..", "supabase", "seed-hub-demo.sql"), "utf8");

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

describe("Hub DEMO seed example (local/staging only)", () => {
  it("loads cleanly: DEMO-labelled events, no logins, nothing queued", async () => {
    await db.admin.query(SEED);
    const ev = await rows<{ title: string; is_demo: boolean }>(db.admin, "select title, is_demo from events");
    expect(ev).toHaveLength(5);
    expect(ev.every((e) => e.is_demo && e.title.startsWith("DEMO "))).toBe(true);
    expect(await rows(db.admin, "select 1 from user_accounts")).toEqual([]);
    expect(await rows(db.admin, "select 1 from notification_outbox")).toEqual([]);
  });

  it("models the demo script: one café cover over three events; Bob confirmed, Steve declined", async () => {
    const [{ n }] = await rows<{ n: number }>(db.admin, "select count(*)::int n from hub_assignments where scope = 'venue'");
    expect(n).toBe(1);
    const covered = await rows<{ title: string }>(db.admin, `
      select e.title from events e join hub_assignments a on a.scope = 'venue' and a.venue_id = e.venue_id
      where e.starts_at < a.ends_at and coalesce(e.ends_at, e.starts_at) >= a.begins_at order by e.title`);
    expect(covered.map((r) => r.title)).toEqual(["DEMO Mini Kickers", "DEMO Veterans v Example Town", "DEMO Youth Home Fixtures"]);
    const ladies = await rows<{ full_name: string; state: string }>(db.admin, `
      select p.full_name, a.state from hub_assignments a join people p on p.id = a.person_id where a.scope = 'event' order by 1`);
    expect(ladies).toEqual([{ full_name: "DEMO Bob", state: "confirmed" }, { full_name: "DEMO Steve", state: "declined" }]);
  });

  it("refuses to load twice", async () => {
    await expect(db.admin.query(SEED)).rejects.toThrow(/already loaded/);
  });
});
