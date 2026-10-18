import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthUser, createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { call, callCommit, hubUser, plainPerson, teamId, type HubUser } from "./hub-fixtures";

/** Stage 1 — people directory, portal accounts, teams and expected officials. */
let db: TestDb;
let admin: HubUser, coord: HubUser, member: HubUser, other: HubUser;

beforeAll(async () => {
  db = await createTestDb();
  admin = await hubUser(db, "admin", "Alex Admin");
  coord = await hubUser(db, "coordinator", "Casey Coordinator");
  member = await hubUser(db, "member", "Mo Member");
  other = await hubUser(db, "member", "Olly Other");
  await db.admin.query("update people set phone_normalized = '+447700900111' where id = $1", [other.id]);
});
afterAll(async () => db?.drop());

const outboxCount = async () => Number((await rows<{ n: string }>(db.admin, "select count(*) n from notification_outbox"))[0].n);

describe("C01 — create a person with a name only", () => {
  it("persists Scott with no email, no account, routine requests off, and sends nothing", async () => {
    const before = await outboxCount();
    const [r] = await callCommit<{ id: string }>(db, admin,
      "select public.hub_create_person($1::jsonb) id", [JSON.stringify({ full_name: "Scott (demo)", involvement: ["manager"] })]);
    const [p] = await rows<Record<string, unknown>>(db.admin, "select * from people where id = $1", [r.id]);
    expect(p.email_normalized).toBeNull();
    expect(p.routine_requests_enabled).toBe(false);
    expect(p.involvement).toEqual(["manager"]);
    expect(await rows(db.admin, "select 1 from user_accounts where person_id = $1", [r.id])).toHaveLength(0);
    expect(await rows(db.admin, "select 1 from auth.users where email is null")).toHaveLength(0);
    expect(await outboxCount()).toBe(before);
  });
  it("rejects a blank name and a malformed email", async () => {
    await expectCode(call(db, admin, "select public.hub_create_person($1::jsonb)", [JSON.stringify({ full_name: "  " })]), "invalid_name");
    await expectCode(call(db, admin, "select public.hub_create_person($1::jsonb)", [JSON.stringify({ full_name: "X", email: "nope" })]), "invalid_email");
  });
});

describe("C02 — create Kelly with contact details, then invite explicitly", () => {
  let kelly: string;
  it("saving with routine requests on sends nothing and creates no account", async () => {
    const before = await outboxCount();
    const [r] = await callCommit<{ id: string }>(db, admin, "select public.hub_create_person($1::jsonb) id",
      [JSON.stringify({ full_name: "Kelly (demo)", email: "Kelly.Demo@Test.Local", phone: "07700 900123", routine_requests_enabled: true, involvement: ["volunteer"] })]);
    kelly = r.id;
    const [p] = await rows<Record<string, unknown>>(db.admin, "select email_normalized::text e, phone_normalized ph, routine_requests_enabled rr from people where id = $1", [kelly]);
    expect(p).toEqual({ e: "kelly.demo@test.local", ph: "+447700900123", rr: true });
    expect(await rows(db.admin, "select 1 from user_accounts where person_id = $1", [kelly])).toHaveLength(0);
    expect(await outboxCount()).toBe(before);
  });
  it("an explicit invite prepares exactly one account, is audited, and a double click does not resend", async () => {
    const [first] = await callCommit<{ r: { status: string; email: string } }>(db, admin, "select public.hub_prepare_portal_invite($1, 'member') r", [kelly]);
    expect(first.r).toEqual({ status: "ready", email: "kelly.demo@test.local" });
    await callCommit(db, admin, "select public.hub_record_invite_result($1, 'sent')", [kelly]);
    const [again] = await callCommit<{ r: { status: string } }>(db, admin, "select public.hub_prepare_portal_invite($1, 'member') r", [kelly]);
    expect(again.r.status).toBe("recently_sent");
    expect(await rows(db.admin, "select 1 from user_accounts where person_id = $1", [kelly])).toHaveLength(1);
    const audit = await rows<{ action: string; actor_person_id: string }>(db.admin,
      "select action, actor_person_id from audit_log where entity_id = $1 and action like 'portal_invite%' order by id", [kelly]);
    expect(audit.map((a) => a.action)).toEqual(["portal_invite_prepared", "portal_invite_sent"]);
    expect(audit[0].actor_person_id).toBe(admin.id);
  });
  it("H06 — a failed invitation stays visible as failed", async () => {
    const id = await plainPerson(db, "Fail Person", { email_normalized: "fail@test.local" });
    await callCommit(db, admin, "select public.hub_prepare_portal_invite($1, 'member')", [id]);
    await callCommit(db, admin, "select public.hub_record_invite_result($1, 'failed', 'provider down')", [id]);
    const dir = await call<{ person_id: string; portal_status: string }>(db, admin, "select person_id, portal_status from hub_directory()");
    expect(dir.find((d) => d.person_id === id)?.portal_status).toBe("invite_failed");
    // and a retry is allowed straight away (only a successful send is de-duplicated)
    const [r] = await call<{ r: { status: string } }>(db, admin, "select public.hub_prepare_portal_invite($1, 'member') r", [id]);
    expect(r.r.status).toBe("ready");
  });
  it("cannot invite without an email, or an under-18", async () => {
    const noEmail = await plainPerson(db, "No Email");
    await expectCode(call(db, admin, "select public.hub_prepare_portal_invite($1, 'member')", [noEmail]), "email_required");
    const minor = await plainPerson(db, "Young Person", { email_normalized: "young@test.local", is_under_18: true, directory_visibility: "private" });
    await expectCode(call(db, admin, "select public.hub_prepare_portal_invite($1, 'member')", [minor]), "minor_no_portal");
  });
  it("only admins can create, edit or invite", async () => {
    await expectCode(call(db, coord, "select public.hub_create_person($1::jsonb)", [JSON.stringify({ full_name: "X" })]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_update_person($1, $2::jsonb)", [kelly, JSON.stringify({ full_name: "Hacked" })]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_prepare_portal_invite($1, 'admin')", [member.id]), "not_authorised");
  });
});

describe("Linking an Auth sign-in to an invited person (by verified email only)", () => {
  it("links an invited person once, refuses the uninvited and the unverified", async () => {
    const id = await plainPerson(db, "Linker", { email_normalized: "linker@test.local" });
    await callCommit(db, admin, "select public.hub_prepare_portal_invite($1, 'member')", [id]);
    const uid = await createAuthUser(db, "LINKER@test.local");
    const link = (u: string) => db.asUserCommit(u, async (c) => (await c.query("select public.link_person_account() r")).rows[0].r);
    expect(await link(uid)).toBe("linked");
    expect(await link(uid)).toBe("already_linked");
    const [acc] = await rows<{ auth_user_id: string }>(db.admin, "select auth_user_id from user_accounts where person_id = $1", [id]);
    expect(acc.auth_user_id).toBe(uid);

    // A person with an email but never invited cannot sign in just because the email matches.
    await plainPerson(db, "Never Invited", { email_normalized: "never@test.local" });
    expect(await link(await createAuthUser(db, "never@test.local"))).toBe("not_invited");
    // Unverified email
    const pending = await plainPerson(db, "Pending", { email_normalized: "pending@test.local" });
    await callCommit(db, admin, "select public.hub_prepare_portal_invite($1, 'member')", [pending]);
    expect(await link(await createAuthUser(db, "pending@test.local", { confirmed: false }))).toBe("unverified");
  });
  it("a disabled account gets no access and helper functions return null", async () => {
    const u = await hubUser(db, "member", "Disabled Dee");
    await db.admin.query("update user_accounts set enabled = false where person_id = $1", [u.id]);
    const [r] = await call<{ id: string | null }>(db, u, "select public.current_person_id() id");
    expect(r.id).toBeNull();
    await expectCode(call(db, u, "select * from hub_directory()"), "not_authorised");
  });
});

describe("C03 / C05 — privacy of people records", () => {
  it("a member cannot read another person's row or contact details directly", async () => {
    const rowsSeen = await call(db, member, "select id, email_normalized, phone_normalized from people");
    expect(rowsSeen).toEqual([{ id: member.id, email_normalized: member.email, phone_normalized: null }]);
    expect(await call(db, member, "select * from user_accounts")).toHaveLength(1);
  });
  it("a member cannot edit someone else (no table write grant, RPC refuses)", async () => {
    await expect(call(db, member, "update people set full_name = 'x' where id = $1", [other.id])).rejects.toThrow(/permission denied/);
    await expectCode(call(db, member, "select public.hub_update_person($1, $2::jsonb)", [other.id, JSON.stringify({ full_name: "x" })]), "not_authorised");
    await expectCode(call(db, member, "select public.hub_set_preferences($1, '{}'::jsonb)", [other.id]), "not_authorised");
  });
  it("directory: members see names but contact details only where shared; organisers see contacts", async () => {
    const asMember = await call<{ person_id: string; phone: string | null; portal_status: string | null }>(db, member, "select * from hub_directory()");
    const o = asMember.find((d) => d.person_id === other.id)!;
    expect(o.phone).toBeNull();
    expect(o.portal_status).toBeNull(); // admin-only
    await db.admin.query("update people set share_phone_with_members = true where id = $1", [other.id]);
    const again = await call<{ person_id: string; phone: string | null }>(db, member, "select * from hub_directory()");
    expect(again.find((d) => d.person_id === other.id)!.phone).toBe("+447700900111");
    await db.admin.query("update people set share_phone_with_members = false where id = $1", [other.id]);
    const asCoord = await call<{ person_id: string; phone: string | null }>(db, coord, "select * from hub_directory()");
    expect(asCoord.find((d) => d.person_id === other.id)!.phone).toBe("+447700900111");
  });
  it("under-18s are never listed to members and can't have shared contacts", async () => {
    const minor = await plainPerson(db, "Minor Listed", { is_under_18: true, directory_visibility: "private" });
    const seen = await call<{ person_id: string }>(db, member, "select person_id from hub_directory()");
    expect(seen.map((s) => s.person_id)).not.toContain(minor);
    await expect(db.admin.query("update people set directory_visibility = 'members' where id = $1", [minor])).rejects.toThrow(/people_minor_private/);
  });
  it("anonymous visitors can read nothing and call nothing", async () => {
    for (const t of ["people", "user_accounts", "team_people", "coordinator_scopes", "volunteer_preferences", "usual_availability"]) {
      await expect(db.asAnon((c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(db.asAnon((c) => c.query("select * from hub_directory()"))).rejects.toThrow(/permission denied/);
  });
});

describe("C04 — one person, many teams and posts; no duplicate on linking", () => {
  it("a linked person has exactly one people row and can hold several team roles", async () => {
    const teams = await Promise.all(["First Team (test)", "Reserves (test)", "Ladies (test)", "Veterans (test)"].map((t) => teamId(db, t)));
    for (const t of teams) {
      await callCommit(db, admin, "select public.hub_set_team_role(null, $1, $2, 'Manager', true, null, null)", [member.id, t]);
    }
    expect(await rows(db.admin, "select 1 from people where email_normalized = $1", [member.email])).toHaveLength(1);
    const dir = await call<{ person_id: string; teams: unknown[] }>(db, admin, "select person_id, teams from hub_directory()");
    expect(dir.find((d) => d.person_id === member.id)!.teams).toHaveLength(4);
  });
  it("duplicate email on create is refused rather than creating a second record", async () => {
    await expectCode(call(db, admin, "select public.hub_create_person($1::jsonb)", [JSON.stringify({ full_name: "Dup", email: member.email.toUpperCase() })]), "duplicate_email");
  });
});

describe("H07 — expected-by-role manager", () => {
  it("records Scott as expected at team events with routine requests off, sending nothing", async () => {
    const before = await outboxCount();
    const scott = await plainPerson(db, "Scott Expected (demo)", { involvement: "{manager}" });
    const t = await teamId(db, "Veterans (test)");
    await callCommit(db, admin, "select public.hub_set_team_role(null, $1, $2, 'Manager', true, null, null)", [scott, t]);
    const [tp] = await rows<{ is_expected_by_default: boolean }>(db.admin, "select is_expected_by_default from team_people where person_id = $1", [scott]);
    expect(tp.is_expected_by_default).toBe(true);
    const [p] = await rows<{ routine_requests_enabled: boolean }>(db.admin, "select routine_requests_enabled from people where id = $1", [scott]);
    expect(p.routine_requests_enabled).toBe(false);
    expect(await outboxCount()).toBe(before);
  });
  it("ending a team role keeps its history", async () => {
    const pid = await plainPerson(db, "Former Coach");
    const t = await teamId(db, "Reserves (test)");
    const [r] = await callCommit<{ id: string }>(db, admin, "select public.hub_set_team_role(null, $1, $2, 'Coach', false, '2026-01-01', null) id", [pid, t]);
    await callCommit(db, admin, "select public.hub_set_team_role($1, $2, $3, 'Coach', false, null, '2026-06-30')", [r.id, pid, t]);
    const [tp] = await rows<{ active_from: Date; active_to: Date }>(db.admin, "select active_from::text, active_to::text from team_people where id = $1", [r.id]);
    expect(tp).toEqual({ active_from: "2026-01-01", active_to: "2026-06-30" });
  });
});

describe("Access management", () => {
  it("keeps at least one active admin", async () => {
    // other admins may exist from earlier tests; demote all but one first
    const admins = await rows<{ person_id: string }>(db.admin, "select person_id from user_accounts where access_level = 'admin' and enabled");
    for (const a of admins.filter((a) => a.person_id !== admin.id)) {
      await db.admin.query("update user_accounts set access_level = 'member' where person_id = $1", [a.person_id]);
    }
    await expectCode(call(db, admin, "select public.hub_set_access($1, 'member', true)", [admin.id]), "last_admin");
  });
  it("members can update their own profile but not their access", async () => {
    await callCommit(db, member, "select public.hub_update_my_profile($1::jsonb)", [JSON.stringify({ display_name: "Mo", phone: "07700 900555" })]);
    const [p] = await rows<{ display_name: string; phone_normalized: string }>(db.admin, "select display_name, phone_normalized from people where id = $1", [member.id]);
    expect(p).toEqual({ display_name: "Mo", phone_normalized: "+447700900555" });
    await expectCode(call(db, member, "select public.hub_set_access($1, 'admin', true)", [member.id]), "not_authorised");
  });
});

describe("C51 (part) — legacy volunteers are bridged without loss", () => {
  let staged: TestDb;
  let legacy: { admin: string; vol: string; uninvited: string; uid: string };
  beforeAll(async () => {
    staged = await createTestDb({
      pauseBefore: "20261019000100",
      atPause: async (a) => {
        const { rows: [u] } = await a.query<{ id: string }>("insert into auth.users (email, email_confirmed_at) values ('carl@test.local', now()) returning id");
        const ins = async (email: string, name: string, role: string, invited: boolean, uid: string | null, phone: string | null = null) =>
          (await a.query<{ id: string }>("insert into volunteers (email, display_name, role, invited_at, auth_user_id, phone) values ($1,$2,$3,$4,$5,$6) returning id",
            [email, name, role, invited ? new Date() : null, uid, phone])).rows[0].id;
        legacy = {
          uid: u.id,
          admin: await ins("carl@test.local", "Carl (test)", "admin", true, u.id, "07700 900000"),
          vol: await ins("vol@test.local", "Val (test)", "volunteer", true, null, "not a phone"),
          uninvited: await ins("later@test.local", "Later (test)", "volunteer", false, null),
        };
        const { rows: [venue] } = await a.query<{ id: string }>("select id from venues where code = 'marke_wood'");
        const { rows: [c] } = await a.query<{ id: string }>("insert into volunteers (email, display_name, role, invited_at) values ('co@test.local','Co (test)','coordinator',now()) returning id");
        await a.query("insert into coordinator_venues (volunteer_id, venue_id) values ($1, $2)", [c.id, venue.id]);
      },
    });
  });
  afterAll(async () => staged?.drop());

  it("copies every volunteer into people with the same id", async () => {
    const n = await rows<{ v: string; p: string }>(staged.admin,
      "select (select count(*) from volunteers) v, (select count(*) from people p join volunteers v on v.id = p.id) p");
    expect(n[0].v).toBe(n[0].p);
    const [carl] = await rows<Record<string, unknown>>(staged.admin, "select full_name, email_normalized::text e, phone_normalized from people where id = $1", [legacy.admin]);
    expect(carl).toEqual({ full_name: "Carl (test)", e: "carl@test.local", phone_normalized: "+447700900000" });
    const [val] = await rows<{ phone_normalized: string | null }>(staged.admin, "select phone_normalized from people where id = $1", [legacy.vol]);
    expect(val.phone_normalized).toBeNull(); // unparseable legacy phone left in volunteers.phone, not lost
    const [legacyPhone] = await rows<{ phone: string }>(staged.admin, "select phone from volunteers where id = $1", [legacy.vol]);
    expect(legacyPhone.phone).toBe("not a phone");
  });
  it("keeps the admin's sign-in and access level; uninvited volunteers get no account", async () => {
    const accs = await rows<{ person_id: string; auth_user_id: string | null; access_level: string }>(staged.admin, "select person_id, auth_user_id, access_level from user_accounts order by access_level");
    expect(accs.find((a) => a.person_id === legacy.admin)).toEqual({ person_id: legacy.admin, auth_user_id: legacy.uid, access_level: "admin" });
    expect(accs.find((a) => a.person_id === legacy.uninvited)).toBeUndefined();
    const r = await staged.asUserCommit(legacy.uid, async (c) => (await c.query("select public.link_person_account() r, public.current_access_level() l")).rows[0]);
    expect(r).toEqual({ r: "already_linked", l: "admin" });
  });
  it("copies coordinator venue scopes", async () => {
    expect(await rows(staged.admin, "select 1 from coordinator_scopes where venue_id is not null")).toHaveLength(1);
  });
});

describe("phone normalisation parity with the app", () => {
  it("SQL and TypeScript agree", async () => {
    const { normalizePhone } = await import("@/lib/domain/hub-tags");
    for (const input of ["07700 900123", "+44 7700 900123", "447700900123", "(01304) 123456", "", "+33 1 23 45 67 89"]) {
      const [r] = await rows<{ v: string | null }>(db.admin, "select public._hub_normalize_phone($1) v", [input]);
      expect(r.v).toBe(normalizePhone(input));
    }
  });
});

describe("rollback script for Stage 1", () => {
  it("applies cleanly and leaves the legacy schema working", async () => {
    const { readFileSync } = await import("node:fs");
    const scratch = await createTestDb({ pauseBefore: "20261019000200" });
    try {
      await scratch.admin.query("begin");
      await scratch.admin.query(readFileSync("docs/sql/rollback-20261019000100.sql", "utf8"));
      await scratch.admin.query("commit");
      expect(await rows(scratch.admin, "select 1 from pg_tables where tablename in ('people','user_accounts')")).toHaveLength(0);
      expect(await rows(scratch.admin, "select count(*) from volunteers")).toHaveLength(1);
    } finally {
      await scratch.drop();
    }
  });
});
