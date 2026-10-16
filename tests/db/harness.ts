/**
 * Database test harness.
 * Creates a throwaway database, applies the Supabase shim and every migration in order,
 * and runs queries as anon or as a specific signed-in user under real RLS.
 *
 * Connection: TEST_PG_ADMIN_URL (default: local socket on port 54329, user postgres).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, type QueryResultRow } from "pg";

const ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL ?? "postgresql://postgres@localhost:54329/postgres?host=/tmp";

const ROOT = join(__dirname, "..", "..");
const SHIM = join(ROOT, "supabase", "tests", "support", "supabase_shim.sql");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function urlFor(db: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export type TestDb = {
  name: string;
  /** Superuser connection: use only to arrange fixtures (like an admin in the dashboard). */
  admin: Client;
  /** Run fn inside a transaction as the anon role. Rolled back afterwards. */
  asAnon<T>(fn: (c: Client) => Promise<T>): Promise<T>;
  /** Run fn inside a transaction as an authenticated user with the given auth uid. Rolled back afterwards. */
  asUser<T>(authUid: string, fn: (c: Client) => Promise<T>): Promise<T>;
  /** Like asUser but COMMITS, for functions whose side effects later steps must see. */
  asUserCommit<T>(authUid: string, fn: (c: Client) => Promise<T>): Promise<T>;
  /** Fresh connection to this database (for concurrency tests). */
  connect(): Promise<Client>;
  drop(): Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const name = `rota_test_${randomBytes(6).toString("hex")}`;
  const root = new Client({ connectionString: ADMIN_URL });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();

  const admin = new Client({ connectionString: urlFor(name) });
  await admin.connect();
  await admin.query(readFileSync(SHIM, "utf8"));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(MIGRATIONS, file), "utf8"));
  }

  async function connect() {
    const c = new Client({ connectionString: urlFor(name) });
    await c.connect();
    return c;
  }

  async function run<T>(
    role: "anon" | "authenticated",
    authUid: string | null,
    commit: boolean,
    fn: (c: Client) => Promise<T>,
  ): Promise<T> {
    const c = await connect();
    try {
      await c.query("begin");
      const claims = JSON.stringify(authUid ? { sub: authUid, role } : { role });
      await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
      await c.query(`set local role ${role}`);
      const out = await fn(c);
      await c.query(commit ? "commit" : "rollback");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      await c.end();
    }
  }

  return {
    name,
    admin,
    asAnon: (fn) => run("anon", null, false, fn),
    asUser: (uid, fn) => run("authenticated", uid, false, fn),
    asUserCommit: (uid, fn) => run("authenticated", uid, true, fn),
    connect,
    async drop() {
      await admin.end();
      const r = new Client({ connectionString: ADMIN_URL });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}

/** Create an Auth user (as Supabase Auth would after an admin invite). */
export async function createAuthUser(
  db: TestDb,
  email: string,
  opts: { confirmed?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await db.admin.query(
    "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)",
    [id, email, opts.confirmed === false ? null : new Date()],
  );
  return id;
}

/** Pre-create a volunteer row (as the admin invite flow does). */
export async function createVolunteer(
  db: TestDb,
  v: {
    email: string;
    displayName?: string;
    role?: "admin" | "coordinator" | "volunteer";
    isActive?: boolean;
    invited?: boolean;
    authUserId?: string | null;
  },
): Promise<string> {
  const { rows } = await db.admin.query<{ id: string }>(
    `insert into public.volunteers (email, display_name, role, is_active, invited_at, auth_user_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      v.email,
      v.displayName ?? v.email.split("@")[0],
      v.role ?? "volunteer",
      v.isActive ?? true,
      v.invited === false ? null : new Date(),
      v.authUserId ?? null,
    ],
  );
  return rows[0].id;
}

export async function rows<T extends QueryResultRow>(c: Client, sql: string, params: unknown[] = []) {
  return (await c.query<T>(sql, params)).rows;
}
