/**
 * Improvement increment 3 (organiser overview and navigation) at phone width, synthetic data only.
 *
 *   tests/e2e/run.sh tests/e2e/improve-organiser-overview.mts
 *   MODE=before SHOTS=… tests/e2e/run.sh …   (screenshots only, against the previous build)
 *
 * Checks: 28-day default finds an uncovered event 13 days out without browsing; attention order
 * (late cancellation first, reconfirmation and approval later); presets are bookmarkable and survive
 * back/forward; actions open the existing routes; coordinator sees only their venue; new nav groups
 * and the mode switch; old URLs still work.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const BEFORE = process.env.MODE === "before";
const SHOTS = process.env.SHOTS ?? "test-results/improve03-after";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, note?: string) => {
  if (BEFORE) return;
  results.push({ check: name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`);
};
const browser = await chromium.launch();

async function phone(email: string) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.fill("#code", "000000");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
  return { ctx, page };
}
const main = async (page: Page) => ((await page.textContent("main")) ?? "").replace(/\s+/g, " ");
const shot = (page: Page, n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}
async function settle(page: Page) { await page.waitForLoadState("networkidle"); }

// ---- Synthetic data -------------------------------------------------------------------------------
await q(`do $$ declare mw uuid := (select id from venues where code = 'marke_wood'); uk text := 'Europe/London';
  d13 date := (now() at time zone 'Europe/London')::date + 13; d2 date := (now() at time zone 'Europe/London')::date + 2;
  d20 date := (now() at time zone 'Europe/London')::date + 20; e uuid; s uuid; a uuid;
  v uuid := (select id from volunteers where email = 'filler@test.local');
begin
  -- 13 days out (the "31 October seen from 18 October" case): needs a site lead, nobody arranged.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (mw, 'SYN Uncovered in 13 days', 'fixture', (d13 + time '11:30') at time zone uk, (d13 + time '17:00') at time zone uk, 'published');

  -- 2 days out: a confirmed helper asks to cancel late.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'SYN Late cancel', 'fixture', (d2 + time '10:00') at time zone uk, (d2 + time '12:00') at time zone uk, 'published', false) returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select e, id, (d2 + time '10:00') at time zone uk, (d2 + time '12:00') at time zone uk, 1 from duty_types where code = 'refreshments' returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, v, 'confirmed', 'self_signup') returning id into a;
  insert into cancellation_requests (assignment_id, volunteer_id, reason) values (a, v, 'Synthetic: working late');

  -- 20 days out: a confirmed helper reset to invited (as postponement/time change does) = reconfirmation.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'SYN Moved event', 'club_event', (d20 + time '10:00') at time zone uk, (d20 + time '12:00') at time zone uk, 'published', false) returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select e, id, (d20 + time '10:00') at time zone uk, (d20 + time '12:00') at time zone uk, 1 from duty_types where code = 'cleaning' returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, v, 'confirmed', 'self_signup') returning id into a;
  update assignments set status = 'invited', responded_at = null where id = a;
end $$;`);

const admin = await phone("admin@test.local");
const A = admin.page;

if (BEFORE) {
  // The previous build has no attention list: capture the same pages for comparison and stop.
  for (const [path, name] of [["/manage", "01-overview-default"], ["/manage/approvals", "02-requests"], ["/manage/coverage", "04-events-coverage-tab"]] as const) {
    await A.goto(`${APP}${path}`); await settle(A); await shot(A, name);
  }
  await browser.close(); await db.end();
  console.log(`before screenshots written to ${SHOTS}`);
  process.exit(0);
}

// 1. Default 28-day range finds the event 13 days out, with the agreed wording.
await A.goto(`${APP}/manage`);
await A.getByRole("heading", { level: 1 }).first().waitFor();
await settle(A);
let t = await main(A);
await shot(A, "01-overview-default");
check("home defaults to Next 28 days (marked current)",
  (await A.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Next 28 days" }).getAttribute("aria-current")) === "page");
check("uncovered event 13 days out is in the attention list without browsing",
  t.includes("SYN Uncovered in 13 days") && t.includes("No confirmed site lead · 11:30–17:00"));
const keys = await A.locator("main ol > li").allTextContents();
const idx = (s: string) => keys.findIndex((k) => k.includes(s));
check("late cancellation is listed first, as Urgent", idx("SYN Late cancel") === 0 && keys[0].includes("Urgent") && keys[0].includes("asked to cancel late"));
check("site-lead gap comes before the reconfirmation", idx("SYN Uncovered in 13 days") >= 0 && idx("SYN Uncovered in 13 days") < idx("SYN Moved event"));
const reconf = keys.findIndex((k) => k.includes("needs to reconfirm"));
check("reconfirmation shown as such (and its open place listed too), not as a fresh invitation",
  reconf >= 0 && keys[reconf].includes("SYN Moved event") && keys[reconf].includes("Reconfirm") && !keys.some((k) => k.includes("SYN Moved event") && k.includes("hasn't answered")));
await noOverflow(A, "overview");

// 2. Actions open the existing routes.
await A.locator("main ol > li", { hasText: "SYN Late cancel" }).getByRole("link", { name: /Review request/ }).click();
await A.waitForURL(/\/manage\/approvals#cancellations$/);
await A.getByRole("heading", { level: 1, name: "Requests" }).waitFor();
t = await main(A);
check("'Review request' opens Requests at the late cancellation", t.includes("Synthetic: working late"));
check("Requests lists the reconfirmation separately", t.includes("Need to reconfirm (1)"));
await shot(A, "02-requests");

// 3. Presets are bookmarkable and survive back/forward.
await A.goto(`${APP}/manage?range=7`);
await settle(A);
t = await main(A);
check("Next 7 days excludes the event 13 days out", !t.includes("SYN Uncovered in 13 days") && t.includes("SYN Late cancel"));
check("requests beyond the range are counted, not hidden", /more request/.test(t));
await A.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Today" }).click();
await A.waitForURL(/range=today/);
await A.goBack();
await A.waitForURL(/range=7$/);
await settle(A);
check("back returns to the bookmarked 7-day range", (await A.getByRole("navigation", { name: "Date range" }).getByRole("link", { name: "Next 7 days" }).getAttribute("aria-current")) === "page");
await shot(A, "03-overview-7-days");

// 4. Navigation groups, primary New event, mode switch, old URLs.
const nav = A.getByRole("navigation", { name: "Organiser" });
const navText = ((await nav.textContent()) ?? "").replace(/\s+/g, " ");
check("nav is Overview, Events, Volunteers, Setup + New event", ["Overview", "Events", "Volunteers", "Setup", "New event"].every((x) => navText.includes(x)) && !navText.includes("Templates"));
await A.goto(`${APP}/manage/coverage`);
await A.getByRole("heading", { level: 1, name: "Coverage" }).waitFor();
check("old /manage/coverage URL works and marks Events current", (await nav.getByRole("link", { name: "Events" }).getAttribute("aria-current")) === "page");
check("Events has Calendar / Coverage / Requests switches", (await A.getByRole("navigation", { name: "Event views" }).getByRole("link").count()) === 3);
await shot(A, "04-events-coverage-tab");
await A.goto(`${APP}/manage/templates`);
await A.getByRole("heading", { level: 1, name: "Templates" }).waitFor();
check("Setup groups Templates and Settings (admin)", (await A.getByRole("navigation", { name: "Setup" }).getByRole("link").allTextContents()).join(",") === "Templates,Settings");
await A.getByRole("link", { name: "Volunteer view" }).click();
await A.waitForURL(/\/rota/);
const sw = await A.getByRole("link", { name: "Organiser view" }).waitFor({ timeout: 10_000 }).then(() => true, () => false);
check("mode switch back to the organiser area is in the volunteer header for organisers", sw);

// 5. Coordinator (Freemens Way only) sees no Marke Wood items and no Settings tab.
const coord = await phone("coord@test.local");
const C = coord.page;
await C.goto(`${APP}/manage`);
await C.getByRole("heading", { level: 1 }).first().waitFor();
await settle(C);
t = await main(C);
check("coordinator overview has no Marke Wood items", !t.includes("SYN Uncovered in 13 days") && !t.includes("SYN Late cancel"));
await C.goto(`${APP}/manage/templates`);
await C.getByRole("heading", { level: 1, name: "Templates" }).waitFor();
check("coordinator Setup shows Templates only", (await C.getByRole("navigation", { name: "Setup" }).getByRole("link").allTextContents()).join(",") === "Templates");
await shot(C, "05-coordinator-overview");

const vol = await phone("vol@test.local");
await vol.page.waitForLoadState("networkidle");
check("volunteers get no organiser switch", (await vol.page.getByRole("link", { name: "Organiser view" }).count()) === 0);

await browser.close();
await db.end();
if (!BEFORE) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
} else console.log(`before screenshots written to ${SHOTS}`);
