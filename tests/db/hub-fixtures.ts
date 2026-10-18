/**
 * Fixtures for Volunteer Hub database tests. Names are anonymised test labels, never real records.
 */
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { createAuthUser, type TestDb } from "./harness";

export type Level = "admin" | "coordinator" | "member";
export type HubUser = { id: string; uid: string; email: string };

/** A person with an enabled, linked portal account (as if invited and signed in). */
export async function hubUser(db: TestDb, level: Level = "member", name?: string): Promise<HubUser> {
  const email = `${level}-${randomBytes(4).toString("hex")}@test.local`;
  const uid = await createAuthUser(db, email);
  const { rows: [p] } = await db.admin.query<{ id: string }>(
    "insert into people (full_name, email_normalized, involvement) values ($1, $2, '{volunteer}') returning id",
    [name ?? `Test ${level}`, email]);
  await db.admin.query(
    "insert into user_accounts (person_id, auth_user_id, access_level, invited_at, invite_state, linked_at) values ($1, $2, $3, now(), 'sent', now())",
    [p.id, uid, level]);
  return { id: p.id, uid, email };
}

/** A directory-only person (no account). */
export async function plainPerson(db: TestDb, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols = ["full_name", ...Object.keys(extra)];
  const vals = [name, ...Object.values(extra)];
  const { rows: [p] } = await db.admin.query<{ id: string }>(
    `insert into people (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, vals);
  return p.id;
}

/** Call a function as a signed-in user; rolled back afterwards. */
export async function call<T = unknown>(db: TestDb, who: HubUser, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.asUser(who.uid, async (c) => (await c.query(sql, params)).rows as T[]);
}

/** Same, but COMMITTED (so later steps can see the effect). */
export async function callCommit<T = unknown>(db: TestDb, who: HubUser, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.asUserCommit(who.uid, async (c) => (await c.query(sql, params)).rows as T[]);
}

export async function one<T = Record<string, unknown>>(c: Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await c.query(sql, params)).rows[0] as T;
}

export async function teamId(db: TestDb, name: string): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    "insert into teams (name) values ($1) on conflict (name) do update set name = excluded.name returning id", [name]);
  return rows[0].id;
}
