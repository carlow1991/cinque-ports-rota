import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

const CANONICAL = [
  ["site_lead", "Site lead / duty manager", true],
  ["open_unlock", "Open and unlock facilities", true],
  ["lock_secure", "Lock and secure facilities", true],
  ["gate_admissions", "Gate / admission collection", false],
  ["refreshments", "Refreshments / tea bar", false],
  ["pitch_setup", "Pitch and equipment setup", false],
  ["facility_checks", "Changing room / facility checks", false],
  ["cleaning", "Post-event cleaning", false],
  ["general_support", "General volunteer support", false],
] as const;

describe("reference data seed", () => {
  it("seeds exactly the nine catalogue duty types, in catalogue order, with authorisation defaults", async () => {
    const r = await rows<{ code: string; name: string; requires_authorisation: boolean }>(
      db.admin, "select code, name, requires_authorisation from duty_types order by sort_order");
    expect(r.map((x) => [x.code, x.name, x.requires_authorisation])).toEqual(CANONICAL.map((x) => [...x]));
  });
  it("has no Parking or Steward duty", async () => {
    const r = await rows(db.admin, "select 1 from duty_types where code ilike any (array['%park%','%steward%']) or name ilike any (array['%park%','%steward%'])");
    expect(r).toEqual([]);
  });
  it("seeds both venues and the single settings row (24h cutoff, reminders on, Europe/London)", async () => {
    expect((await rows<{ code: string }>(db.admin, "select code from venues order by code")).map((v) => v.code)).toEqual(["freemens_way", "marke_wood"]);
    expect(await rows(db.admin, "select withdrawal_cutoff_hours, reminder_day_before, timezone from club_settings"))
      .toEqual([{ withdrawal_cutoff_hours: 24, reminder_day_before: true, timezone: "Europe/London" }]);
  });
  it("is idempotent and keyed by code: re-running changes nothing and keeps admin authorisation choices", async () => {
    await db.admin.query("update duty_types set requires_authorisation = true where code = 'gate_admissions'");
    const seed = readFileSync(join(__dirname, "..", "..", "supabase", "migrations", "20261016000600_seed_reference_data.sql"), "utf8");
    await db.admin.query(seed);
    await db.admin.query(seed);
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int as n from duty_types"))[0].n).toBe(9);
    expect((await rows<{ n: number }>(db.admin, "select count(*)::int as n from venues"))[0].n).toBe(2);
    const [g] = await rows<{ requires_authorisation: boolean }>(db.admin, "select requires_authorisation from duty_types where code = 'gate_admissions'");
    expect(g.requires_authorisation).toBe(true);
  });
  it("duty codes are unique (cannot add a duplicate)", async () => {
    await expect(db.admin.query("insert into duty_types (code, name) values ('cleaning', 'Dup')")).rejects.toThrow(/duplicate key/);
  });
});
