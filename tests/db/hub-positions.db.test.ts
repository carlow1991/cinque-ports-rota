import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, type HubUser } from "./hub-fixtures";

/** Stage 5 — club positions, derived occupancy, independent recruiting flags, public-safe opportunities. */
let db: TestDb;
let admin: HubUser, carl: HubUser, member: HubUser;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  carl = await hubUser(db, "member", "Carl (demo)");
  member = await hubUser(db, "member", "Mo Member");
  await db.admin.query("update people set phone_normalized = '+447700900444' where id = $1", [carl.id]);
  const [{ n }] = await callCommit<{ n: number }>(db, admin, "select public.hub_add_suggested_positions() n");
  expect(n).toBe(8);
  for (const r of await rows<{ id: string; title: string }>(db.admin, "select id, title from club_positions")) ids[r.title] = r.id;
});
afterAll(async () => db?.drop());

type Pos = { id: string; title: string; occupancy: string; seeking_replacement: boolean; seeking_additional_help: boolean; holders: { person_id: string; name: string }[]; public_reason: string | null };
const positions = async (who: HubUser) => (await call<{ r: Pos[] }>(db, who, "select public.hub_positions() r"))[0].r;
const pub = async () => db.asService(async (c) => (await c.query("select public.public_opportunities() r")).rows[0].r as Record<string, unknown>[]);

describe("C33 — one person, many posts; filled AND recruiting", () => {
  it("suggested roles start empty: vacant, not advertised", async () => {
    const p = await positions(member);
    expect(p).toHaveLength(8);
    expect(p.every((x) => x.occupancy === "vacant" && !x.seeking_replacement && x.public_reason === null)).toBe(true);
    expect(await pub()).toEqual([]);
  });
  it("Carl holds eight posts; Club Secretary is Filled + Seeking replacement; Groundsman Filled + Extra help", async () => {
    for (const t of Object.keys(ids)) await callCommit(db, admin, "select public.hub_add_holder($1, $2, '2024-08-01')", [ids[t], carl.id]);
    await db.admin.query("update club_positions set public_visible = true");
    await callCommit(db, admin, "select public.hub_set_recruiting($1, true, false, false)", [ids["Club Secretary"]]);
    await callCommit(db, admin, "select public.hub_set_recruiting($1, false, true, false)", [ids["Groundsman"]]);
    const p = await positions(member);
    const sec = p.find((x) => x.title === "Club Secretary")!, gr = p.find((x) => x.title === "Groundsman")!;
    expect(sec).toMatchObject({ occupancy: "filled", seeking_replacement: true, public_reason: "successor" });
    expect(sec.holders.map((h) => h.person_id)).toEqual([carl.id]); // Carl stays the holder
    expect(gr).toMatchObject({ occupancy: "filled", seeking_additional_help: true, public_reason: "extra_help" });
    expect(p.filter((x) => x.holders.some((h) => h.person_id === carl.id))).toHaveLength(8);
  });
  it("both flags together are fine", async () => {
    await callCommit(db, admin, "select public.hub_set_recruiting($1, true, true, false)", [ids["Finance"]]);
    expect((await positions(member)).find((x) => x.title === "Finance")).toMatchObject({ seeking_replacement: true, seeking_additional_help: true, occupancy: "filled" });
  });
  it("the directory shows Carl's club roles", async () => {
    const d = await call<{ person_id: string; positions: string[] }>(db, member, "select person_id, positions from hub_directory()");
    expect(d.find((x) => x.person_id === carl.id)!.positions).toHaveLength(8);
  });
});

describe("C34 — shared posts and history", () => {
  it("two active holders = shared; succession keeps correct historic dates", async () => {
    const other = await plainPerson(db, "Successor (demo)");
    await callCommit(db, admin, "select public.hub_add_holder($1, $2, '2026-01-01', 'joint')", [ids["Social Media"], other]);
    expect((await positions(member)).find((x) => x.title === "Social Media")!.occupancy).toBe("shared");
    const [{ id: carlHolding }] = await rows<{ id: string }>(db.admin, "select id from position_holders where club_position_id = $1 and person_id = $2", [ids["Social Media"], carl.id]);
    await callCommit(db, admin, "select public.hub_end_holder($1, '2026-06-30')", [carlHolding]);
    const after = (await positions(admin)).find((x) => x.title === "Social Media") as Pos & { history: { name: string; start_date: string; end_date: string }[] };
    expect(after.occupancy).toBe("filled");
    expect(after.history).toEqual([expect.objectContaining({ name: "Carl (demo)", start_date: "2024-08-01", end_date: "2026-06-30" })]);
    expect(await rows(db.admin, "select 1 from position_holders where id = $1", [carlHolding])).toHaveLength(1); // never deleted
    await expectCode(call(db, admin, "select public.hub_end_holder($1, '2026-07-01')", [carlHolding]), "invalid_transition");
  });
  it("vacant + advertised shows publicly as a vacancy", async () => {
    const [{ id }] = await callCommit<{ id: string }>(db, admin, "select public.hub_save_position(null, $1::jsonb) id",
      [JSON.stringify({ title: "Programme Secretary", public_summary: "Keeps the matchday programme going.", public_visible: true })]);
    await callCommit(db, admin, "select public.hub_set_recruiting($1, false, false, true)", [id]);
    expect((await pub()).find((x) => x.id === id)).toMatchObject({ reason: "vacant", summary: "Keeps the matchday programme going." });
  });
});

describe("C35 — public opportunities are public-safe", () => {
  it("contain role copy only: no holder names, contact details, notes or interests", async () => {
    await db.admin.query("update club_positions set recruiting_contact_person_id = $1", [carl.id]);
    const json = JSON.stringify(await pub());
    expect(json).not.toContain("Carl");
    expect(json).not.toContain("7700");
    expect(json).not.toContain(carl.id);
    expect(json).not.toMatch(/holder|note|interest|email|phone/i);
  });
  it("only the server's secret key can call it; anonymous and signed-in users can't", async () => {
    await expect(db.asAnon((c) => c.query("select public.public_opportunities()"))).rejects.toThrow(/permission denied/);
    await expect(call(db, member, "select public.public_opportunities()")).rejects.toThrow(/permission denied/);
    for (const t of ["club_positions", "position_holders", "position_interests"]) {
      await expect(db.asAnon((c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
  it("a role that stops recruiting disappears from the public page", async () => {
    await callCommit(db, admin, "select public.hub_set_recruiting($1, false, false, false)", [ids["Groundsman"]]);
    expect((await pub()).map((x) => x.id)).not.toContain(ids["Groundsman"]);
  });
});

describe("interest and succession", () => {
  it("a member registers interest once; admins track stages without any formal appointment", async () => {
    await callCommit(db, member, "select public.hub_register_interest($1)", [ids["Club Secretary"]]);
    await callCommit(db, member, "select public.hub_register_interest($1)", [ids["Club Secretary"]]);
    const [i] = await rows<{ id: string; stage: string }>(db.admin, "select id, stage from position_interests where person_id = $1", [member.id]);
    expect(i.stage).toBe("interested");
    for (const s of ["discussion", "shadowing", "handover"]) await callCommit(db, admin, "select public.hub_set_interest($1, null, null, $2)", [i.id, s]);
    expect((await rows<{ stage: string }>(db.admin, "select stage from position_interests where id = $1", [i.id]))[0].stage).toBe("handover");
    expect(await rows(db.admin, "select 1 from position_holders where person_id = $1", [member.id])).toHaveLength(0);
  });
  it("can't register interest in a role that isn't recruiting", async () => {
    await expectCode(call(db, member, "select public.hub_register_interest($1)", [ids["Vice-Chairman"]]), "not_recruiting");
  });
  it("members can't edit roles, holders or flags", async () => {
    await expectCode(call(db, member, "select public.hub_set_recruiting($1, true, true, true)", [ids["Finance"]]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_add_holder($1, $2)", [ids["Finance"], member.id]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_save_position(null, '{\"title\":\"x\"}'::jsonb)"), "not_authorised");
  });
  it("members don't see others' interest or holder notes in the tables", async () => {
    expect(await call(db, member, "select id from position_interests where person_id <> $1", [member.id])).toHaveLength(0);
    expect(await call(db, member, "select id from position_holders where person_id <> $1", [member.id])).toHaveLength(0);
    // Admin notes aren't selectable at all, even on their own rows.
    await expect(call(db, member, "select * from position_interests")).rejects.toThrow(/permission denied/);
  });
});

describe("rollback script for Stage 5", () => {
  it("applies cleanly and the directory still works", async () => {
    const { readFileSync } = await import("node:fs");
    const scratch = await createTestDb({ stopBefore: "20261019000600" });
    try {
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000500.sql", "utf8")}; commit;`);
      const m = await hubUser(scratch, "member");
      await scratch.asUser(m.uid, (c) => c.query("select * from hub_directory()"));
      expect(await rows(scratch.admin, "select 1 from pg_tables where tablename = 'club_positions'")).toHaveLength(0);
    } finally {
      await scratch.drop();
    }
  });
});
