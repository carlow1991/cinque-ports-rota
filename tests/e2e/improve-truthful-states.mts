/**
 * Improvement increment 2 (truthful states) at phone width, on synthetic data only.
 *
 *   tests/e2e/run.sh tests/e2e/improve-truthful-states.mts
 *   MODE=before SHOTS=test-results/improve-before tests/e2e/run.sh ...   (screenshots only, no checks;
 *   used against the previous build to capture "before" pictures)
 *
 * Scenarios: an empty day with a next-event hint; a site lead who has asked to cancel late (at risk,
 * exact gap, badge); a filter that matches nothing; the picker's "No rota clash" label; an invite
 * result message that says email was queued (staging mode: approved addresses only), not sent.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const BEFORE = process.env.MODE === "before";
const SHOTS = process.env.SHOTS ?? "test-results/improve-after";
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
async function open(page: Page, path: string, h1: string | RegExp) {
  await page.goto(`${APP}${path}`);
  await page.getByRole("heading", { level: 1, name: h1 }).waitFor();
}
const main = async (page: Page) => ((await page.textContent("main")) ?? "").replace(/\s+/g, " ");
const shot = (page: Page, n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}

// ---- Synthetic data (test database only) ---------------------------------------------------------
const dayKey = async (offset: number) =>
  (await q<{ d: string }>("select to_char((now() at time zone 'Europe/London')::date + $1::int, 'YYYY-MM-DD') as d", [offset]))[0].d;
const AT_RISK_DAY = await dayKey(40), EMPTY_DAY = await dayKey(300), NEXT_DAY = await dayKey(302);
await q(`do $$ declare v uuid; u uuid; e uuid; s uuid; a uuid; mw uuid := (select id from venues where code = 'marke_wood');
begin
  insert into auth.users (email, email_confirmed_at) values ('sam.synthetic@test.local', now()) returning id into u;
  insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at)
  values ('sam.synthetic@test.local', 'Sam Synthetic', 'volunteer', now(), u, now()) returning id into v;
  insert into volunteer_duty_authorisations (volunteer_id, duty_type_id)
  select v, id from duty_types where code in ('site_lead', 'open_unlock', 'lock_secure');

  -- 40 days out, 10:00–12:00 UK: a site lead confirmed for the whole time, who then asks to cancel.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (mw, 'SYN Lead asked to cancel', 'fixture',
          (('${AT_RISK_DAY}'::date + time '10:00') at time zone 'Europe/London'),
          (('${AT_RISK_DAY}'::date + time '12:00') at time zone 'Europe/London'), 'published') returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select e, id, (('${AT_RISK_DAY}'::date + time '10:00') at time zone 'Europe/London'), (('${AT_RISK_DAY}'::date + time '12:00') at time zone 'Europe/London'), 1
  from duty_types where code = 'site_lead' returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, v, 'confirmed', 'self_signup') returning id into a;
  insert into cancellation_requests (assignment_id, volunteer_id, reason) values (a, v, 'Synthetic: away that weekend');
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select e, id, (('${AT_RISK_DAY}'::date + time '10:00') at time zone 'Europe/London'), (('${AT_RISK_DAY}'::date + time '12:00') at time zone 'Europe/London'), 1
  from duty_types where code = 'general_support';

  -- The next thing scheduled after an otherwise empty day.
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'SYN Next fixture', 'fixture', (('${NEXT_DAY}'::date + time '14:00') at time zone 'Europe/London'),
          (('${NEXT_DAY}'::date + time '16:00') at time zone 'Europe/London'), 'published', false);
end $$;`);
// Increment 6: email is held in a fresh database; this test checks the pilot-mode wording, so start it.
await q("update club_settings set email_released_from = now() where id = 1");
const atRiskEvent = (await q<{ id: string }>("select id from events where title = 'SYN Lead asked to cancel'"))[0].id;
const supportShift = (await q<{ id: string }>(
  "select s.id from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'general_support'", [atRiskEvent]))[0].id;

const admin = await phone("admin@test.local");
const A = admin.page;

// 1. An empty day says so, and points to the next scheduled event.
await open(A, `/manage/coverage?day=${EMPTY_DAY}`, "Coverage");
let t = await main(A);
check("empty day: says there are no events (not 'everything is filled')", t.includes("No events in this period.") && !t.includes("Everything is filled"));
check("empty day: shows the next scheduled event", t.includes("Next scheduled: SYN Next fixture"));
await noOverflow(A, "coverage empty day"); await shot(A, "01-coverage-empty-day");

// 2. A lead with a pending late cancellation is not counted as cover.
await open(A, `/manage/coverage?day=${AT_RISK_DAY}`, "Coverage");
t = await main(A);
check("late-cancel lead: event listed as site lead missing or at risk", t.includes("Site lead missing or at risk (1)") && t.includes("SYN Lead asked to cancel"));
check("late-cancel lead: exact gap in the agreed wording", t.includes("No confirmed site lead · 10:00–12:00"));
check("late-cancel lead: duty row says someone asked to cancel", t.includes("1 asked to cancel"));
await noOverflow(A, "coverage at risk"); await shot(A, "02-coverage-lead-asked-to-cancel");

// 3. A filter that matches nothing says so.
await open(A, `/manage/coverage?day=${AT_RISK_DAY}&duty=cleaning`, "Coverage");
t = await main(A);
check("filter with no matches: 'No duties match these filters.'", t.includes("No duties match these filters."));
await shot(A, "03-coverage-filter-no-match");

// 4. The event page names the lead but does not call them cover.
await open(A, `/manage/events/${atRiskEvent}`, "SYN Lead asked to cancel");
t = await main(A);
check("event page: lead badge says asked to cancel, not 'Site lead confirmed'", t.includes("Sam Synthetic") && t.includes("Asked to cancel, not counted as cover") && !t.includes("Site lead confirmed"));
await noOverflow(A, "event page"); await shot(A, "04-event-lead-asked-to-cancel");

// 5. The picker says what it actually checked, and the invite message is honest about email.
await open(A, `/manage/shifts/${supportShift}/assign`, "Invite a volunteer");
t = await main(A);
check("picker: 'No rota clash' instead of 'Available'", t.includes("No rota clash") && !/\bAvailable\b/.test(t));
await shot(A, "05-picker-no-rota-clash");
await A.locator("li", { hasText: "Filler Person" }).getByRole("button", { name: "Invite" }).click();
await A.locator("li", { hasText: "Filler Person" }).getByText("Already invited").waitFor();
t = await main(A);
check("picker says invitation emails are queued for approved addresses only (pilot/staging), not sent",
  t.includes("Invitation emails are queued, but in pilot mode only approved addresses receive them") && !t.includes("Invitation sent"));
await shot(A, "06-invite-result-message");

await browser.close();
await db.end();
if (!BEFORE) {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
} else console.log(`before screenshots written to ${SHOTS}`);
