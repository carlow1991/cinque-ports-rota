import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode } from "./fixtures";
import { HUB_SELECT_ONLY_TABLES, SERVICE_ROLE_FUNCTIONS } from "./allowlists";

const byName = (a: { table_name: string }, b: { table_name: string }) => (a.table_name < b.table_name ? -1 : a.table_name > b.table_name ? 1 : 0);

/**
 * Phase 7 pre-pilot security audit, run against migrations applied ON TOP OF Supabase's real
 * default privileges (see supabase_shim.sql). Pins exactly what each API role can touch, so any
 * future grant drift fails the build. Row-level rules are tested elsewhere (permissions,
 * volunteer-views, organiser, outbox…); this file checks the outer walls.
 */
let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

const tableGrants = (role: string) =>
  rows<{ table_name: string; p: string }>(db.admin,
    `select table_name, string_agg(privilege_type, ',' order by privilege_type) p
       from information_schema.role_table_grants where grantee = $1 and table_schema = 'public' group by 1 order by 1`, [role]);
const columnOnlyGrants = (role: string) =>
  rows<{ table_name: string; privilege_type: string; cols: string }>(db.admin,
    `select table_name, privilege_type, string_agg(column_name, ',' order by column_name) cols
       from information_schema.column_privileges c where grantee = $1 and table_schema = 'public'
        and not exists (select 1 from information_schema.role_table_grants t where t.grantee = c.grantee
                        and t.table_schema = 'public' and t.table_name = c.table_name and t.privilege_type = c.privilege_type)
      group by 1, 2 order by 1, 2`, [role]);
const callable = async (role: string) =>
  (await rows<{ proname: string }>(db.admin,
    `select distinct proname from pg_proc where pronamespace = 'public'::regnamespace
       and has_function_privilege($1, oid, 'execute') order by 1`, [role])).map((r) => r.proname);
const sequences = async (role: string) =>
  (await rows<{ n: number }>(db.admin,
    `select count(*)::int n from (select oid from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' offset 0) c
      where has_sequence_privilege($1, c.oid, 'usage') or has_sequence_privilege($1, c.oid, 'update')`, [role]))[0].n;

describe("outer walls", () => {
  it("every table in public has row level security switched on", async () => {
    const off = await rows(db.admin, "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity");
    expect(off).toEqual([]);
  });

  it("every SECURITY DEFINER function pins an empty search_path (no hijacking by lookalike objects)", async () => {
    const bad = await rows(db.admin,
      `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
         and not ('search_path=""' = any (coalesce(proconfig, '{}')) or 'search_path=' = any (coalesce(proconfig, '{}')))`);
    expect(bad).toEqual([]);
  });

  it("no RLS policy applies to anonymous visitors; every policy targets signed-in users only", async () => {
    const pol = await rows<{ tablename: string; roles: string }>(db.admin, "select tablename, roles::text from pg_policies where schemaname = 'public'");
    expect(pol.length).toBeGreaterThan(10);
    expect(pol.filter((p) => p.roles !== "{authenticated}")).toEqual([]);
  });
});

describe("anonymous visitors (publishable key, not signed in)", () => {
  it("have no table, column, sequence or function access at all", async () => {
    expect(await tableGrants("anon")).toEqual([]);
    expect(await columnOnlyGrants("anon")).toEqual([]);
    expect(await sequences("anon")).toBe(0);
    expect(await callable("anon")).toEqual([]);
  });
});

describe("signed-in users (authenticated): exact grant snapshot; RLS narrows every row further", () => {
  it("table-level grants", async () => {
    const hub = HUB_SELECT_ONLY_TABLES.map((t) => ({ table_name: t, p: "SELECT" }));
    expect((await tableGrants("authenticated")).sort(byName)).toEqual([...hub, ...[
      { table_name: "assignments", p: "SELECT" },
      { table_name: "audit_log", p: "SELECT" },
      { table_name: "cancellation_requests", p: "SELECT" },
      { table_name: "club_settings", p: "SELECT" },
      { table_name: "coordinator_venues", p: "DELETE,INSERT,SELECT" },
      { table_name: "duty_template_items", p: "DELETE,INSERT,SELECT,UPDATE" },
      { table_name: "duty_templates", p: "INSERT,SELECT,UPDATE" },
      { table_name: "duty_types", p: "INSERT,SELECT,UPDATE" },
      { table_name: "event_shift_responsibilities", p: "DELETE,INSERT,SELECT" },
      { table_name: "event_shifts", p: "SELECT" },
      { table_name: "events", p: "SELECT" },
      { table_name: "teams", p: "INSERT,SELECT,UPDATE" },
      { table_name: "template_item_responsibilities", p: "DELETE,INSERT,SELECT,UPDATE" },
      { table_name: "venues", p: "INSERT,SELECT,UPDATE" },
      { table_name: "volunteer_duty_authorisations", p: "SELECT" },
      { table_name: "volunteers", p: "SELECT" },
    ]].sort(byName));
  });
  it("no direct writes to assignments, cancellations, authorisations, audit or the outbox", async () => {
    const g = await tableGrants("authenticated");
    for (const t of ["assignments", "cancellation_requests", "volunteer_duty_authorisations", "audit_log"]) {
      expect(g.find((x) => x.table_name === t)?.p).toBe("SELECT");
    }
    expect(g.find((x) => x.table_name === "notification_outbox")).toBeUndefined();
  });
  it("column-limited writes (email, role, active flag, status, times and venue are never client-writable)", async () => {
    const c = await columnOnlyGrants("authenticated");
    expect(c).toEqual([
      { table_name: "club_settings", privilege_type: "UPDATE", cols: "reminder_day_before,withdrawal_cutoff_hours" },
      { table_name: "event_shifts", privilege_type: "INSERT", cols: "approval_required,duty_type_id,ends_at,event_id,instructions,required_count,signup_enabled,source_template_item_id,starts_at" },
      { table_name: "event_shifts", privilege_type: "UPDATE", cols: "instructions" },
      { table_name: "events", privilege_type: "INSERT", cols: "competition,coverage_event_id,description,ends_at,event_type,instructions,kickoff_at,opponent,site_responsibility,starts_at,team_id,title,venue_id" },
      { table_name: "events", privilege_type: "UPDATE", cols: "competition,description,instructions,kickoff_at,opponent,site_responsibility,team_id,title" },
      { table_name: "volunteers", privilege_type: "UPDATE", cols: "display_name,phone,preferred_venue_id" },
    ]);
    const ev = c.find((x) => x.table_name === "events" && x.privilege_type === "INSERT")!.cols.split(",");
    expect(ev).not.toContain("status");
    expect(ev).not.toContain("is_demo");
  });
  it("no sequence access", async () => {
    expect(await sequences("authenticated")).toBe(0);
  });
  it("cannot call the secret-key-only functions", async () => {
    const f = await callable("authenticated");
    for (const n of ["outbox_claim", "outbox_complete", "outbox_suppress", "outbox_enqueue_reminders", "admin_bootstrap_volunteer"]) expect(f).not.toContain(n);
  });
});

describe("the secret key (service_role): least privilege", () => {
  it("has no direct table, sequence or column access, despite Supabase's defaults", async () => {
    expect(await tableGrants("service_role")).toEqual([]);
    expect(await columnOnlyGrants("service_role")).toEqual([]);
    expect(await sequences("service_role")).toBe(0);
    await expect(db.asService((c) => c.query("select email, phone from public.volunteers"))).rejects.toThrow(/permission denied/);
    await expect(db.asService((c) => c.query("select * from public.audit_log"))).rejects.toThrow(/permission denied/);
  });
  it("can call exactly the email worker functions and the first-admin bootstrap", async () => {
    expect(await callable("service_role")).toEqual(SERVICE_ROLE_FUNCTIONS);
  });
});

describe("first-admin bootstrap (scripts/invite-volunteer.mts)", () => {
  const boot = (email: string, name: string, role = "volunteer") =>
    db.asService(async (c) => (await c.query("select public.admin_bootstrap_volunteer($1, $2, $3::public.app_role) as r", [email, name, role])).rows[0].r as { volunteer_id: string; existing: boolean; already_linked: boolean });

  it("creates the first admin with a normalised email, and re-running updates rather than duplicates", async () => {
    const a = await boot("  First.Admin@Club.example ", "First Admin", "admin");
    expect(a).toMatchObject({ existing: false, already_linked: false });
    const b = await boot("first.admin@club.example", "First A. Admin", "admin");
    expect(b).toMatchObject({ existing: true, volunteer_id: a.volunteer_id });
    const [v] = await rows<{ email: string; display_name: string; role: string; is_active: boolean }>(db.admin, "select email::text, display_name, role, is_active from volunteers where id = $1", [a.volunteer_id]);
    expect(v).toEqual({ email: "first.admin@club.example", display_name: "First A. Admin", role: "admin", is_active: true });
  });
  it("validates input and never demotes the last admin", async () => {
    await expectCode(boot("not-an-email", "X"), "invalid_email");
    await expectCode(boot("ok@club.example", ""), "invalid_name");
    await expectCode(boot("first.admin@club.example", "First", "volunteer"), "last_admin");
  });
});
