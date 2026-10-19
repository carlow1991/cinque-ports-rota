import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { SERVICE_ROLE_FUNCTIONS, SIGNED_IN_FUNCTIONS } from "./allowlists";

/**
 * Sweep EVERY function in the public schema. Any new function must either be deliberately added
 * to the allow-list (and the lockdown migration) or stay uncallable. Catches the PUBLIC default-
 * execute trap that let Phase 3/4 functions be callable by anonymous users.
 */
const ALLOWED_FOR_SIGNED_IN = SIGNED_IN_FUNCTIONS;

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => db?.drop());

const callable = async (role: string) =>
  (await rows<{ proname: string }>(db.admin,
    `select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
       and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.proname);

describe("function privileges", () => {
  it("anonymous visitors can execute NO function in the public schema", async () => {
    expect(await callable("anon")).toEqual([]);
  });
  it("signed-in users can execute exactly the allow-list (no internal helpers)", async () => {
    expect(await callable("authenticated")).toEqual(ALLOWED_FOR_SIGNED_IN);
  });
  it("the secret-key role can call exactly the four outbox functions and the first-admin bootstrap", async () => {
    expect(await callable("service_role")).toEqual(SERVICE_ROLE_FUNCTIONS);
  });
  it("internal helpers stay uncallable", async () => {
    const all = (await rows<{ proname: string }>(db.admin, "select distinct proname from pg_proc where pronamespace = 'public'::regnamespace")).map((r) => r.proname);
    const internal = all.filter((n) => !ALLOWED_FOR_SIGNED_IN.includes(n));
    expect(internal).toEqual(expect.arrayContaining(["_has_overlap", "_apply_template", "_enqueue", "missing_authorisations", "_fail"]));
  });
  it("a function created later does not become callable by anon (default privilege removed)", async () => {
    await db.admin.query("create function public.zz_probe() returns int language sql as 'select 1'");
    expect(await callable("anon")).toEqual([]);
    await db.admin.query("drop function public.zz_probe()");
  });
});
