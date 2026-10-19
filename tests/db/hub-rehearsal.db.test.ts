import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestDb, rows, type TestDb } from "./harness";

/**
 * C51 — migration rehearsal on a database shaped like production on 18 Oct 2026 (synthetic data, no real
 * personal details): 1 linked admin, 2 active venues, 1 published fixture with 4 template shifts, no
 * assignments, ~70 audit rows. Apply every Hub migration, prove legacy data is preserved (checksums),
 * then apply every rollback script in reverse and prove the legacy schema and data are back.
 */
const LEGACY_CHECKSUMS: Record<string, string> = {
  volunteers: "select md5(string_agg(concat_ws(',', id, email, display_name, role, is_active, auth_user_id), '|' order by id)) v from volunteers",
  events: "select md5(string_agg(concat_ws(',', id, title, starts_at, ends_at, venue_id, status, event_type), '|' order by id)) v from events",
  event_shifts: "select md5(string_agg(concat_ws(',', id, event_id, duty_type_id, starts_at, ends_at, required_count, status), '|' order by id)) v from event_shifts",
  venues: "select md5(string_agg(concat_ws(',', id, code, name), '|' order by id)) v from venues",
  duty_templates: "select md5(string_agg(concat_ws(',', id, code, name), '|' order by id)) v from duty_templates",
  duty_types: "select md5(string_agg(concat_ws(',', id, code, name), '|' order by id)) v from duty_types",
  assignments: "select count(*)::text v from assignments",
};
async function checksums(c: Client) {
  const out: Record<string, string> = {};
  for (const [k, sql] of Object.entries(LEGACY_CHECKSUMS)) out[k] = (await c.query(sql)).rows[0].v;
  out.audit_rows_min = String((await c.query("select count(*) n from audit_log")).rows[0].n);
  return out;
}

let db: TestDb;
let before: Record<string, string>;
let adminUid: string, adminId: string, eventId: string;

beforeAll(async () => {
  db = await createTestDb({
    pauseBefore: "20261019000100",
    atPause: async (a) => {
      adminUid = (await a.query<{ id: string }>("insert into auth.users (email, email_confirmed_at) values ('owner@example.org', now()) returning id")).rows[0].id;
      adminId = (await a.query<{ id: string }>("insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at) values ('Owner@Example.org', 'Club Owner (test)', 'admin', now(), $1, now()) returning id", [adminUid])).rows[0].id;
      await a.query("update venues set active = true"); // both active, as in production
      const [{ id: mw }] = (await a.query<{ id: string }>("select id from venues where code = 'marke_wood'")).rows;
      eventId = (await a.query<{ id: string }>("insert into events (venue_id, title, event_type, starts_at, ends_at, status, created_by) values ($1, 'Reserves v Test (rehearsal)', 'fixture', '2026-10-31 12:30+00', '2026-10-31 16:30+00', 'published', $2) returning id", [mw, adminId])).rows[0].id;
      for (const code of ["site_lead", "gate_admissions", "refreshments", "cleaning"]) {
        const [{ id: d }] = (await a.query<{ id: string }>("select id from duty_types where code = $1", [code])).rows;
        await a.query("insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values ($1, $2, '2026-10-31 12:00+00', '2026-10-31 16:30+00', 1)", [eventId, d]);
      }
      before = await checksums(a);
    },
  });
});
afterAll(async () => db?.drop());

describe("C51 — rehearsal of the Hub migrations on production-shaped data", () => {
  it("legacy data is unchanged after all Hub migrations (only Freemens Way's active flag changes)", async () => {
    const after = await checksums(db.admin);
    const { audit_rows_min: a1, ...restBefore } = before;
    const { audit_rows_min: a2, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(Number(a2)).toBeGreaterThanOrEqual(Number(a1)); // audit history only grows
    expect((await rows<{ code: string; active: boolean }>(db.admin, "select code, active from venues order by code")).map((v) => [v.code, v.active]))
      .toEqual([["freemens_way", false], ["marke_wood", true]]);
  });
  it("the owner keeps admin access with the same sign-in, and the fixture keeps its id", async () => {
    const r = await db.asUserCommit(adminUid, async (c) => (await c.query("select public.link_person_account() l, public.current_access_level() a, public.current_person_id() p")).rows[0]);
    expect(r).toEqual({ l: "already_linked", a: "admin", p: adminId });
    const [e] = await rows<{ category: string; volunteers_enabled: boolean }>(db.admin, "select category, volunteers_enabled from events where id = $1", [eventId]);
    expect(e).toEqual({ category: "match", volunteers_enabled: false });
    const inv = await db.asUser(adminUid, async (c) => (await c.query("select public.hub_event_involvement($1) r", [eventId])).rows[0].r);
    expect(inv.can_manage).toBe(true);
  });
  it("every rollback script applies in reverse order and restores the legacy schema and data", async () => {
    const scripts = readdirSync("docs/sql").filter((f) => /^rollback-20261019\d+\.sql$/.test(f)).sort().reverse();
    expect(scripts).toHaveLength(8);
    for (const f of scripts) {
      await db.admin.query(`begin; ${readFileSync(`docs/sql/${f}`, "utf8")}; commit;`).catch(async (e) => {
        await db.admin.query("rollback").catch(() => {});
        throw new Error(`${f}: ${(e as Error).message}`);
      });
    }
    const hubTables = await rows(db.admin, `select tablename from pg_tables where schemaname = 'public' and tablename in
      ('people','user_accounts','team_people','coordinator_scopes','availability_requests','event_availability','hub_assignments',
       'club_positions','position_holders','position_interests','volunteer_applications','application_role_suggestions','hub_rate_events')`);
    expect(hubTables).toEqual([]);
    const after = await checksums(db.admin);
    const { audit_rows_min: _a, ...restBefore } = before;
    const { audit_rows_min: _b, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect((await rows<{ active: boolean }>(db.admin, "select active from venues where code = 'freemens_way'"))[0].active).toBe(true);
    // The legacy sign-in function still works for the owner.
    const r = await db.asUserCommit(adminUid, async (c) => (await c.query("select public.link_volunteer_account() l")).rows[0].l);
    expect(r).toBe("already_linked");
  });
});
