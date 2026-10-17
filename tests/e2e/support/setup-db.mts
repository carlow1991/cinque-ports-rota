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

// ---- Phase 4 volunteer scenarios (non-demo, clearly prefixed "E2E") ----------------------
const { rows: [other] } = await db.query("insert into auth.users (email, email_confirmed_at) values ('other@test.local', now()) returning id");
await db.query("insert into volunteers (email, display_name, phone, role, invited_at, auth_user_id, linked_at) values ('other@test.local', 'Other Person', '07700 900999', 'volunteer', now(), $1, now())", [other.id]);
const { rows: [filler] } = await db.query("insert into auth.users (email, email_confirmed_at) values ('filler@test.local', now()) returning id");
await db.query("insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at) values ('filler@test.local', 'Filler Person', 'volunteer', now(), $1, now())", [filler.id]);

await db.query(`
do $$
declare
  mw uuid := (select id from venues where code = 'marke_wood');
  vol uuid := (select id from volunteers where email = 'vol@test.local');
  oth uuid := (select id from volunteers where email = 'other@test.local');
  base date := ((now() at time zone 'Europe/London')::date + 3);
  uk text := 'Europe/London';
  e uuid; s uuid;
  function_at timestamptz;
begin
  -- Main event: 3 days ahead, 14:00–16:00 UK.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Sunday fixture', 'fixture', (base + time '14:00') at time zone uk, (base + time '16:00') at time zone uk, 'published', false)
  returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, instructions)
  values (e, (select id from duty_types where code='pitch_setup'), (base + time '13:00') at time zone uk, (base + time '14:00') at time zone uk, 1, 'Corner flags and nets.');
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code='cleaning'), (base + time '16:00') at time zone uk, (base + time '16:45') at time zone uk, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, oth, 'confirmed', 'self_signup');
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, approval_required)
  values (e, (select id from duty_types where code='gate_admissions'), (base + time '14:00') at time zone uk, (base + time '14:30') at time zone uk, 1, true);
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code='site_lead'), (base + time '13:00') at time zone uk, (base + time '17:00') at time zone uk, 1);
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code='refreshments'), (base + time '14:00') at time zone uk, (base + time '16:00') at time zone uk, 2) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, oth, 'confirmed', 'self_signup');
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code='general_support'), (base + time '13:30') at time zone uk, (base + time '14:30') at time zone uk, 1);

  -- Two invitations (5 days ahead).
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Invitation event', 'club_event', (base + 2 + time '10:00') at time zone uk, (base + 2 + time '12:00') at time zone uk, 'published', false)
  returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values
    (e, (select id from duty_types where code='refreshments'), (base + 2 + time '10:00') at time zone uk, (base + 2 + time '11:00') at time zone uk, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, vol, 'invited', 'admin_allocation');
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values
    (e, (select id from duty_types where code='cleaning'), (base + 2 + time '12:00') at time zone uk, (base + 2 + time '12:30') at time zone uk, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, vol, 'invited', 'admin_allocation');

  -- Confirmed duty 6 days ahead (can withdraw online).
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Withdrawable duty event', 'fixture', (base + 3 + time '15:00') at time zone uk, (base + 3 + time '17:00') at time zone uk, 'published', false)
  returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values
    (e, (select id from duty_types where code='cleaning'), (base + 3 + time '17:00') at time zone uk, (base + 3 + time '17:30') at time zone uk, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, vol, 'confirmed', 'self_signup');

  -- Confirmed duty starting in 10 hours (inside the 24h cut-off).
  function_at := date_trunc('minute', now()) + interval '10 hours';
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Soon event', 'training', function_at, function_at + interval '90 minutes', 'published', false)
  returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values
    (e, (select id from duty_types where code='pitch_setup'), function_at - interval '15 minutes', function_at, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, vol, 'confirmed', 'self_signup');

  -- Past duty, attended.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Last week fixture', 'fixture', now() - interval '7 days', now() - interval '7 days' + interval '2 hours', 'completed', false)
  returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count) values
    (e, (select id from duty_types where code='cleaning'), now() - interval '7 days' + interval '2 hours', now() - interval '7 days' + interval '150 minutes', 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source, attendance_status) values (s, vol, 'confirmed', 'self_signup', 'present');

  -- A draft volunteers must never see.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (mw, 'E2E Secret draft', 'fixture', (base + time '18:00') at time zone uk, (base + time '19:00') at time zone uk, 'draft');
end $$;`);

await db.end();
console.log(u.toString());
