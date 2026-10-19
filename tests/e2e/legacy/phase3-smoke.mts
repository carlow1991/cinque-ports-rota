/**
 * Phase 3 end-to-end smoke check at phone width (375px), against the test-only fake Supabase
 * (tests/e2e/support/fake-supabase.mts) backed by real Postgres + RLS.
 *
 *   APP_URL=http://localhost:3200 DB_URL=postgresql://… node tests/e2e/phase3-smoke.mts
 * Writes screenshots to $SHOTS (default ./test-results/phase3).
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? "test-results/phase3";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const { rows: [demo] } = await db.query(
  "select to_char((starts_at at time zone 'Europe/London')::date, 'YYYY-MM-DD') as day from events where title = 'DEMO First Team v Example Town'");

const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };

const browser = await chromium.launch();

async function session(email: string) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
  await page.goto(`${APP}/login`);
  await page.fill("#email", email);
  await page.click("button[type=submit]");
  await page.fill("#code", "000000");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
  return { ctx, page };
}

async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

// ---------------- Admin ----------------
{
  const { page, ctx } = await session("admin@test.local");
  check("admin lands on organiser dashboard", new URL(page.url()).pathname === "/manage");
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  await noOverflow(page, "dashboard"); await shot(page, "01-dashboard");

  await page.goto(`${APP}/manage/calendar?week=${demo.day}`);
  await page.waitForSelector("text=DEMO First Team v Example Town");
  const calText = await page.textContent("main");
  check("calendar shows both venues' DEMO events in UK time", Boolean(calText?.includes("DEMO U7/U9 youth fixture block") && calText.includes("All times UK")));
  check("calendar flags the same-venue overlap", Boolean(calText?.includes("Overlaps with")));
  check("calendar shows DEMO labels", (await page.locator("text=DEMO").count()) > 3);
  await noOverflow(page, "calendar"); await shot(page, "02-calendar");

  // Build a T01 fixture with gate + tea bar.
  await page.goto(`${APP}/manage/events/new`);
  await page.waitForSelector("text=1. What and where");
  await page.selectOption("select[name=venue_id]", { label: "Marke Wood" });
  await page.fill("input[name=title]", "Smoke test First Team fixture");
  await page.fill("input[name=date]", demo.day);
  await page.fill("input[name=start]", "15:00");
  await page.fill("input[name=end]", "16:50");
  await page.selectOption("select[name=template_id]", { label: "T01: Marke Wood: First Team home fixture" });
  await page.getByLabel(/Gate \/ admission collection/).check();
  await page.getByLabel(/Refreshments \/ tea bar/).check();
  const preview = await page.locator("text=duty row(s)").textContent();
  check("builder preview: T01 + gate + tea = 5 rows, 8 places", Boolean(preview?.includes("5 duty row(s), 8 place(s)")), preview ?? "");
  check("builder shows site lead includes open/check/lock", (await page.locator("text=Includes: Open and unlock facilities").count()) > 0);
  await noOverflow(page, "new event"); await shot(page, "03-new-event");
  await Promise.all([page.waitForURL(/\/manage\/events\/[0-9a-f-]{36}/), page.click("text=Create draft event")]);
  await page.waitForSelector("text=Draft created");
  const dutyRows = await page.locator("main ul li:has(p.font-semibold)").count();
  check("created event has exactly 5 duty rows", dutyRows === 5, `${dutyRows}`);
  check("event page shows 0/8 confirmed", Boolean((await page.textContent("main"))?.includes("0/8 confirmed")));
  await shot(page, "04-event-draft");
  await Promise.all([page.waitForURL(/published=1/), page.click("text=Publish event")]);
  await page.waitForSelector("text=Volunteers can now see this event");
  const { rows: [pub] } = await db.query("select status from events where title = 'Smoke test First Team fixture'");
  check("publish is saved, then confirmed on the page", pub.status === "published");
  await noOverflow(page, "event page"); await shot(page, "05-event-published");

  // Youth block linked to venue cover: no duplicate site lead, honest cover warning.
  const { rows: [youth] } = await db.query("select id from events where title = 'DEMO U7/U9 youth fixture block'");
  await page.goto(`${APP}/manage/events/${youth.id}`);
  await page.waitForSelector("text=Site cover");
  const yText = await page.textContent("main");
  const youthDuties = await page.locator("main ul li:has(p.font-semibold) > div > div > p.font-semibold").allTextContents();
  check("linked youth block has no own site-lead duty", youthDuties.length === 2 && !youthDuties.includes("Site lead / duty manager"), youthDuties.join(", "));
  check("linked cover with no confirmed lead is shown as at risk (not green)", Boolean(yText?.includes("Venue cover at risk")));
  await shot(page, "06-linked-youth-block");

  await page.goto(`${APP}/manage/templates`);
  await page.waitForSelector("text=T09: Venue opening / closing coverage");
  check("templates page lists T01–T09", (await page.locator("h2:has-text('T0')").count()) === 9);
  await noOverflow(page, "templates"); await shot(page, "07-templates");

  await page.goto(`${APP}/manage/settings`);
  await page.waitForSelector("text=Rota rules");
  check("admin can open settings", true);
  await noOverflow(page, "settings"); await shot(page, "08-settings");
  await ctx.close();
}

// ---------------- Coordinator (Freemens Way only) ----------------
{
  const { page, ctx } = await session("coord@test.local");
  await page.goto(`${APP}/manage/settings`);
  await page.waitForURL((u) => u.pathname === "/rota");
  check("coordinator is refused admin settings (server redirect)", new URL(page.url()).pathname === "/rota");
  await page.goto(`${APP}/manage/events/new`);
  const venues = await page.locator("select[name=venue_id] option").allTextContents();
  check("coordinator can only create events at Freemens Way", venues.length === 1 && venues[0] === "Freemens Way", venues.join(", "));
  await page.goto(`${APP}/manage/calendar?week=${demo.day}`);
  await page.waitForSelector("text=DEMO U7/U9 youth fixture block");
  const t = await page.textContent("main");
  const venueOptions = await page.locator("select[name=venue] option").allTextContents();
  check("coordinator's venue filter offers only their venue", venueOptions.join("|") === "Both venues|Freemens Way" || venueOptions.join("|") === "My venues|Freemens Way", venueOptions.join(", "));
  check("coordinator calendar excludes the other venue", !(t ?? "").includes("DEMO First Team v Example Town") && Boolean(t?.includes("DEMO U7/U9 youth fixture block")));
  await ctx.close();
}

// ---------------- Volunteer ----------------
{
  const { page, ctx } = await session("vol@test.local");
  check("volunteer lands on /rota", new URL(page.url()).pathname === "/rota");
  await page.goto(`${APP}/manage`);
  await page.waitForURL((u) => u.pathname === "/rota");
  check("volunteer is refused the organiser area (server redirect)", new URL(page.url()).pathname === "/rota");
  await ctx.close();
}

await browser.close();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
