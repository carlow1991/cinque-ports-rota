/**
 * Fixture builders for database tests. They use the superuser connection (like an admin
 * working directly in the database) purely to ARRANGE state; every behaviour under test
 * is then exercised as a real signed-in role through RLS and the public RPCs.
 */
import type { Client } from "pg";
import { createAuthUser, createVolunteer, rows, type TestDb } from "./harness";

export type Role = "admin" | "coordinator" | "volunteer";
export type Person = { id: string; uid: string; email: string };

let seq = 0;
const uniq = (p: string) => `${p}${++seq}-${Math.random().toString(36).slice(2, 7)}`;

export async function person(db: TestDb, role: Role = "volunteer", opts: { active?: boolean; name?: string } = {}): Promise<Person> {
  const email = `${uniq(role)}@example.org`;
  const uid = await createAuthUser(db, email);
  const id = await createVolunteer(db, { email, role, authUserId: uid, displayName: opts.name ?? email.split("@")[0], isActive: opts.active ?? true });
  return { id, uid, email };
}

export async function venueId(db: TestDb, code: "marke_wood" | "freemens_way"): Promise<string> {
  return (await rows<{ id: string }>(db.admin, "select id from venues where code = $1", [code]))[0].id;
}

export async function dutyId(db: TestDb, code: string): Promise<string> {
  return (await rows<{ id: string }>(db.admin, "select id from duty_types where code = $1", [code]))[0].id;
}

export async function makeCoordinator(db: TestDb, venues: string[]): Promise<Person> {
  const p = await person(db, "coordinator");
  for (const v of venues) await db.admin.query("insert into coordinator_venues (volunteer_id, venue_id) values ($1, $2)", [p.id, v]);
  return p;
}

export async function authorise(db: TestDb, volunteerId: string, code: string, validUntil: Date | null = null, active = true) {
  await db.admin.query(
    `insert into volunteer_duty_authorisations (volunteer_id, duty_type_id, valid_until, active)
     values ($1, (select id from duty_types where code = $2), $3, $4)
     on conflict (volunteer_id, duty_type_id) do update set valid_until = excluded.valid_until, active = excluded.active`,
    [volunteerId, code, validUntil, active],
  );
}

/**
 * Hours from a FIXED reference time (the next whole minute when the tests start), so
 * "the same time" computed twice is identical, just as real rota times are exact minutes.
 */
const T0 = Math.ceil(Date.now() / 60_000) * 60_000 + 60_000;
export const inHours = (h: number) => new Date(T0 + Math.round(h * 60) * 60_000);

export async function makeEvent(
  db: TestDb,
  o: {
    venue: string;
    start: Date;
    end: Date;
    status?: "draft" | "published" | "postponed" | "cancelled" | "completed";
    type?: string;
    title?: string;
    coverageEventId?: string | null;
    siteResponsibility?: boolean;
    isDemo?: boolean;
  },
): Promise<string> {
  const { rows: r } = await db.admin.query<{ id: string }>(
    `insert into events (venue_id, title, event_type, starts_at, ends_at, status, coverage_event_id, site_responsibility, is_demo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [o.venue, o.title ?? uniq("Event "), o.type ?? "fixture", o.start, o.end, o.status ?? "published",
     o.coverageEventId ?? null, o.siteResponsibility ?? true, o.isDemo ?? false],
  );
  return r[0].id;
}

export async function makeShift(
  db: TestDb,
  o: { event: string; duty: string; start: Date; end: Date; required?: number; approval?: boolean; signup?: boolean; responsibilities?: string[] },
): Promise<string> {
  const { rows: r } = await db.admin.query<{ id: string }>(
    `insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, approval_required, signup_enabled)
     values ($1, (select id from duty_types where code = $2), $3, $4, $5, $6, $7) returning id`,
    [o.event, o.duty, o.start, o.end, o.required ?? 1, o.approval ?? false, o.signup ?? true],
  );
  for (const code of o.responsibilities ?? []) {
    await db.admin.query(
      "insert into event_shift_responsibilities (shift_id, duty_type_id) values ($1, (select id from duty_types where code = $2))",
      [r[0].id, code],
    );
  }
  return r[0].id;
}

/** Insert an assignment directly (arrange-only; bypasses RPC checks). */
export async function seedAssignment(db: TestDb, shift: string, volunteer: string, status: string, source = "self_signup") {
  const { rows: r } = await db.admin.query<{ id: string }>(
    "insert into assignments (shift_id, volunteer_id, status, source) values ($1, $2, $3, $4) returning id",
    [shift, volunteer, status, source],
  );
  return r[0].id;
}

export async function statusOf(db: TestDb, assignmentId: string): Promise<string> {
  return (await rows<{ status: string }>(db.admin, "select status from assignments where id = $1", [assignmentId]))[0].status;
}

/** Call an RPC as a user and COMMIT. Returns the jsonb result. */
export async function rpc<T = Record<string, unknown>>(db: TestDb, who: Person, fn: string, args: unknown[] = []): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  return db.asUserCommit(who.uid, async (c: Client) => (await c.query(`select public.${fn}(${placeholders}) as r`, args)).rows[0].r as T);
}

/** Expect an RPC to fail with a specific error code (the exception message). */
export async function expectCode(p: Promise<unknown>, code: string) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`expected error "${code}" but the call succeeded`);
  const e = err as { message?: string; detail?: string };
  const msg = `${e.message ?? String(err)} | ${e.detail ?? ""}`;
  if (!msg.includes(code)) throw new Error(`expected error "${code}" but got "${msg}"`);
}
