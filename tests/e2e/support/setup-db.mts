/**
 * TEST-ONLY: build a fresh local database for end-to-end checks: Supabase shim, every migration,
 * the DEMO seed, and three signed-up test people. Prints the connection URL.
 *
 *   node tests/e2e/support/setup-db.mts [dbname]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? "postgresql://postgres@localhost:54329/postgres?host=/tmp";
const name = process.argv[2] ?? "rota_e2e";

const root = new pg.Client({ connectionString: ADMIN_URL });
await root.connect();
await root.query(`drop database if exists ${name} with (force)`);
await root.query(`create database ${name}`);
await root.end();

const u = new URL(ADMIN_URL);
u.pathname = `/${name}`;
const db = new pg.Client({ connectionString: u.toString() });
await db.connect();
await db.query(readFileSync(join(ROOT, "supabase/tests/support/supabase_shim.sql"), "utf8"));
for (const f of readdirSync(join(ROOT, "supabase/migrations")).filter((x) => x.endsWith(".sql")).sort()) {
  await db.query(readFileSync(join(ROOT, "supabase/migrations", f), "utf8"));
}
await db.query(readFileSync(join(ROOT, "supabase/seed.sql"), "utf8"));

const people = [
  ["admin@test.local", "Alex Admin", "admin"],
  ["coord@test.local", "Casey Coordinator", "coordinator"],
  ["vol@test.local", "Val Volunteer", "volunteer"],
] as const;
for (const [email, display, role] of people) {
  const { rows } = await db.query("insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id", [email]);
  await db.query(
    "insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at) values ($1, $2, $3, now(), $4, now())",
    [email, display, role, rows[0].id],
  );
}
await db.query(
  "insert into coordinator_venues (volunteer_id, venue_id) select v.id, ve.id from volunteers v, venues ve where v.email = 'coord@test.local' and ve.code = 'freemens_way'",
);
await db.end();
console.log(u.toString());
