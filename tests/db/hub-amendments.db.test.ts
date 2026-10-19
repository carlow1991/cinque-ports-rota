import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, teamId, type HubUser } from "./hub-fixtures";

/** Amendments of 19 Oct 2026: several contact methods, club vs team-management roles, team league/division. */
let db: TestDb;
let admin: HubUser, coord: HubUser, member: HubUser;
let reserves: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  coord = await hubUser(db, "coordinator", "Casey Coordinator");
  member = await hubUser(db, "member", "Mo Member");
  reserves = await teamId(db, "Reserves");
});
afterAll(async () => db?.drop());

describe("contact methods — more than one", () => {
  it("a member saves WhatsApp and email together; unknown values are ignored", async () => {
    await callCommit(db, member, "select public.hub_update_my_profile($1::jsonb)", [JSON.stringify({ contact_channels: ["whatsapp", "email", "carrier-pigeon"] })]);
    const [p] = await call<{ contact_channels: string[] }>(db, member, "select contact_channels from people where id = $1", [member.id]);
    expect(p.contact_channels).toEqual(["email", "whatsapp"]);
  });
  it("administrators record them on any person; clearing all leaves none", async () => {
    const [{ id }] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_person($1::jsonb) id", [JSON.stringify({ full_name: "Kelly (demo)", contact_channels: ["phone", "text"] })]);
    expect((await rows<{ c: string[] }>(db.admin, "select contact_channels c from people where id = $1", [id]))[0].c).toEqual(["phone", "text"]);
    await callCommit(db, admin, "select public.hub_update_person($1, $2::jsonb)", [id, JSON.stringify({ full_name: "Kelly (demo)", contact_channels: [] })]);
    expect((await rows<{ c: string[] }>(db.admin, "select contact_channels c from people where id = $1", [id]))[0].c).toEqual([]);
  });
  it("the database refuses anything outside the list", async () => {
    await expect(db.admin.query("update people set contact_channels = '{fax}' where id = $1", [member.id])).rejects.toThrow(/check/);
  });
  it("anonymising clears them", async () => {
    const id = await plainPerson(db, "Leaver (demo)", { contact_channels: ["email", "whatsapp"] });
    await callCommit(db, admin, "select public.hub_anonymise_person($1)", [id]);
    expect((await rows<{ c: string[] }>(db.admin, "select contact_channels c from people where id = $1", [id]))[0].c).toEqual([]);
  });
});

describe("teams — league and division", () => {
  it("administrators record them; members can't change teams", async () => {
    await callCommit(db, admin, "update teams set league = 'Kent County League', division = 'Division One East' where id = $1", [reserves]);
    expect(await call(db, member, "update teams set league = 'x' where id = $1 returning id", [reserves])).toEqual([]);
    const [t] = await call<{ league: string; division: string }>(db, member, "select league, division from teams where id = $1", [reserves]);
    expect(t).toEqual({ league: "Kent County League", division: "Division One East" });
  });
});

describe("club roles vs team management", () => {
  let coachRole = "";
  it("a team-management role is tied to a team; a club role never is", async () => {
    [{ id: coachRole }] = await callCommit<{ id: string }>(db, admin, "select public.hub_save_position(null, $1::jsonb) id",
      [JSON.stringify({ title: "Reserves Coach", kind: "team", team_id: reserves, public_visible: true })]);
    const [{ id: sec }] = await callCommit<{ id: string }>(db, admin, "select public.hub_save_position(null, $1::jsonb) id",
      [JSON.stringify({ title: "Club Secretary", kind: "club", team_id: reserves })]);
    const r = await rows<{ title: string; kind: string; team_id: string | null }>(db.admin, "select title, kind, team_id from club_positions where id in ($1, $2) order by title", [coachRole, sec]);
    expect(r).toEqual([{ title: "Club Secretary", kind: "club", team_id: null }, { title: "Reserves Coach", kind: "team", team_id: reserves }]);
    await expectCode(call(db, admin, "select public.hub_save_position(null, $1::jsonb)", [JSON.stringify({ title: "X", kind: "players" })]), "invalid_kind");
  });
  it("members see the kind, team, league and division", async () => {
    const [{ r }] = await call<{ r: { title: string; kind: string; team: string | null; league: string | null }[] }>(db, member, "select public.hub_positions() r");
    expect(r.find((p) => p.title === "Reserves Coach")).toMatchObject({ kind: "team", team: "Reserves", league: "Kent County League" });
    expect(r.find((p) => p.title === "Club Secretary")).toMatchObject({ kind: "club", team: null });
  });
  it("the public list carries kind and team (still no names or contacts)", async () => {
    await callCommit(db, admin, "select public.hub_set_recruiting($1, false, true, false)", [coachRole]);
    const r = await db.asService(async (c) => (await c.query("select public.public_opportunities() r")).rows[0].r as Record<string, unknown>[]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Reserves Coach", kind: "team", team: "Reserves", division: "Division One East", reason: "extra_help" });
    expect(JSON.stringify(r)).not.toMatch(/Admin|Coordinator|@/);
  });
});

describe("team staff list", () => {
  it("members see listed staff; under-18s and unlisted people only for organisers; no contact details", async () => {
    const manager = await plainPerson(db, "Scott (demo)", { email_normalized: "scott@example.org" });
    const junior = await plainPerson(db, "Junior helper (demo)", { is_under_18: true, directory_visibility: "private" });
    for (const [pid, role] of [[manager, "Manager"], [junior, "Assistant"]]) {
      await callCommit(db, admin, "select public.hub_set_team_role(null, $1, $2, $3, true, null, null)", [pid, reserves, role]);
    }
    const forMember = (await call<{ r: { team: string; staff: { name: string }[] }[] }>(db, member, "select public.hub_team_staff() r"))[0].r;
    const res = forMember.find((t) => t.team === "Reserves")!;
    expect(res.staff.map((s) => s.name)).toEqual(["Scott (demo)"]);
    expect(JSON.stringify(forMember)).not.toContain("@");
    const forCoord = (await call<{ r: { team: string; staff: { name: string }[] }[] }>(db, coord, "select public.hub_team_staff() r"))[0].r;
    expect(forCoord.find((t) => t.team === "Reserves")!.staff.map((s) => s.name).sort()).toEqual(["Junior helper (demo)", "Scott (demo)"]);
  });
  it("signed-out visitors can't call it", async () => {
    await expect(db.asAnon((c) => c.query("select public.hub_team_staff()"))).rejects.toThrow(/permission denied/);
  });
});

describe("rollback script for the amendments", () => {
  it("applies cleanly and the earlier screens' functions still work", async () => {
    const scratch = await createTestDb();
    try {
      const a = await hubUser(scratch, "admin");
      await scratch.asUserCommit(a.uid, (c) => c.query("select public.hub_update_my_profile($1::jsonb)", [JSON.stringify({ contact_channels: ["whatsapp"] })]));
      await scratch.admin.query(`begin; ${readFileSync("docs/sql/rollback-20261019000900.sql", "utf8")}; commit;`);
      expect((await rows<{ c: string }>(scratch.admin, "select preferred_contact_channel c from people where id = $1", [a.id]))[0].c).toBe("whatsapp");
      await scratch.asUser(a.uid, (c) => c.query("select public.hub_positions()"));
      expect(await rows(scratch.admin, "select 1 from information_schema.columns where table_name = 'teams' and column_name = 'league'")).toEqual([]);
    } finally {
      await scratch.drop();
    }
  });
});
