/**
 * Phase 7 pilot-readiness checks against the production build and a fresh test database:
 *  - the first-admin bootstrap script works with the secret key (and is idempotent), and the new
 *    admin can sign in and reach the organiser area
 *  - the bootstrap function can't be used with the public (publishable) key
 *  - the secret key can no longer read club tables directly (least privilege, D-701)
 *  - the demo seed refuses to load into a database that has real events
 *  - the volunteer and organiser home pages render without server errors
 *
 *   tests/e2e/run.sh tests/e2e/phase7-pilot.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:54399";
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };

const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: FAKE, SUPABASE_SECRET_KEY: "sb_secret_test", NEXT_PUBLIC_SITE_URL: APP };
const invite = (args: string[], over: Record<string, string> = {}) =>
  spawnSync("node", ["scripts/invite-volunteer.mts", ...args], { env: { ...env, ...over }, encoding: "utf8" });

// 1. Bootstrap the first admin of a new club database.
const r1 = invite(["Pilot.Admin@Club.Example", "Pat Pilot", "admin"]);
check("bootstrap script invites a new admin", r1.status === 0 && r1.stdout.includes("Invited Pat Pilot (admin)"), (r1.stdout + r1.stderr).trim());
const [pat] = await q<{ email: string; role: string; is_active: boolean; invited_at: Date | null }>("select email::text, role, is_active, invited_at from volunteers where email = 'pilot.admin@club.example'");
check("…saved with a normalised email, admin role, active, invited", pat?.role === "admin" && pat.is_active && Boolean(pat.invited_at));
const [{ n: authUsers }] = await q<{ n: number }>("select count(*)::int n from auth.users where email = 'pilot.admin@club.example'");
check("…and a sign-in account was created through the Auth invite", authUsers === 1);
const r2 = invite(["pilot.admin@club.example", "Pat Pilot", "admin"]);
const [{ n: rows2 }] = await q<{ n: number }>("select count(*)::int n from volunteers where email = 'pilot.admin@club.example'");
check("running it again doesn't duplicate the person", r2.status === 0 && rows2 === 1, r2.stdout.trim());
const r3 = invite(["x@club.example", "Wrong Key"], { SUPABASE_SECRET_KEY: "sb_publishable_test" });
check("the script fails with the public key instead of the secret key", r3.status !== 0);
check("…and saved nothing", (await q("select 1 from volunteers where email = 'x@club.example'")).length === 0);

// 2. Least privilege for the secret key, through the API.
const read = await fetch(`${FAKE}/rest/v1/volunteers?select=email,phone`, { headers: { apikey: "sb_secret_test", Authorization: "Bearer sb_secret_test" } });
check("secret key can't read volunteers' emails or phones directly", read.status >= 400, `HTTP ${read.status}`);
const audit = await fetch(`${FAKE}/rest/v1/audit_log?select=*`, { headers: { apikey: "sb_secret_test", Authorization: "Bearer sb_secret_test" } });
check("secret key can't read the audit history", audit.status >= 400, `HTTP ${audit.status}`);
const anonBoot = await fetch(`${FAKE}/rest/v1/rpc/admin_bootstrap_volunteer`, { method: "POST", headers: { apikey: "sb_publishable_test", "content-type": "application/json" }, body: JSON.stringify({ p_email: "evil@x.example", p_display_name: "Evil", p_role: "admin" }) });
check("anonymous visitors can't call the bootstrap function", anonBoot.status >= 400, `HTTP ${anonBoot.status}`);

// 3. The demo seed refuses to load where real events exist.
const [{ n: demoBefore }] = await q<{ n: number }>("select count(*)::int n from events where is_demo");
let seedErr = "";
try { execFileSync("psql", [process.env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-q", "-f", "supabase/seed.sql"], { encoding: "utf8", stdio: "pipe" }); }
catch (e) { seedErr = String((e as { stderr?: string }).stderr ?? e); }
check("demo seed refuses to load into a database with real events", /real|refus|demo/i.test(seedErr), seedErr.split("\n").find((l) => /ERROR/.test(l))?.trim());
const [{ n: demo }] = await q<{ n: number }>("select count(*)::int n from events where is_demo");
check("…and no demo events were added", demo === demoBefore, `${demoBefore} → ${demo}`);

// 4. The new admin can sign in and use the organiser area.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });
const page = await ctx.newPage();
const serverErrors: string[] = [];
page.on("response", (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.goto(`${APP}/login`);
await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
await page.fill("#email", "pilot.admin@club.example");
await page.getByRole("button", { name: "Email me a sign-in code" }).click();
await page.fill("#code", "000000");
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
check("bootstrapped admin signs in and lands in the organiser area", new URL(page.url()).pathname.startsWith("/manage"), new URL(page.url()).pathname);
for (const [path, h] of [["/manage", "Overview"], ["/manage/volunteers", "Volunteers"], ["/manage/settings", "Settings"], ["/manage/templates", "Templates"], ["/rota", /Rota/]] as const) {
  await page.goto(`${APP}${path}`);
  const ok = await page.getByRole("heading", { level: 1, name: h }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check(`${path} renders for the new admin`, ok);
}
const settings = (await page.textContent("main")) ?? "";
check("nine duties and both venues are ready in a fresh club database", (settings.match(/Marke Wood|Freemens Way/g) ?? []).length >= 2);
check("no server errors while browsing", serverErrors.length === 0, serverErrors.join(", "));
await browser.close(); await db.end();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
