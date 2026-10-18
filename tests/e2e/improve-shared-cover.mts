/**
 * Improvement increment 7 (shared venue cover) at phone width, synthetic data only.
 *
 *   tests/e2e/run.sh tests/e2e/improve-shared-cover.mts
 *   MODE=before SHOTS=… tests/e2e/run.sh …   (screenshots only, against the previous build)
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const BEFORE = process.env.MODE === "before";
const SHOTS = process.env.SHOTS ?? "test-results/improve07-after";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };
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
async function go(page: Page, path: string) { await page.goto(`${APP}${path}`); await page.getByRole("heading", { level: 1 }).first().waitFor(); await page.waitForLoadState("networkidle"); }
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}

// ---- Synthetic data, 30 days out at Freemens Way -----------------------------------------------
const D = (await q<{ d: string }>("select to_char((now() at time zone 'Europe/London')::date + 30, 'YYYY-MM-DD') as d"))[0].d;
await q(`do $$ declare fw uuid := (select id from venues where code = 'freemens_way'); uk text := 'Europe/London';
  d date := '${D}'::date; cov uuid; s uuid; y uuid;
begin
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (fw, 'SYN FW Saturday cover', 'venue_coverage', (d + time '08:00') at time zone uk, (d + time '14:00') at time zone uk, 'published') returning id into cov;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select cov, id, (d + time '08:00') at time zone uk, (d + time '14:00') at time zone uk, 1 from duty_types where code = 'site_lead' returning id into s;
  insert into event_shift_responsibilities (shift_id, duty_type_id)
  select s, id from duty_types where code in ('open_unlock', 'facility_checks', 'lock_secure');
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (fw, 'SYN FW late cover', 'venue_coverage', (d + time '10:00') at time zone uk, (d + time '16:00') at time zone uk, 'published');
  insert into events (venue_id, title, event_type, starts_at, ends_at, status)
  values (fw, 'SYN Youth block', 'fixture', (d + time '09:00') at time zone uk, (d + time '12:00') at time zone uk, 'draft') returning id into y;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select y, id, (d + time '08:15') at time zone uk, (d + time '09:00') at time zone uk, 2 from duty_types where code = 'pitch_setup';
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  select y, id, (d + time '12:00') at time zone uk, (d + time '12:30') at time zone uk, 1 from duty_types where code = 'cleaning';
end $$;`);
const id = async (title: string) => (await q<{ id: string }>("select id from events where title = $1", [title]))[0].id;
const [cover, youth] = [await id("SYN FW Saturday cover"), await id("SYN Youth block")];

const admin = await phone("admin@test.local");
const A = admin.page;

if (BEFORE) {
  await go(A, `/manage/events/${youth}`); await shot(A, "01-youth-site-cover");
  await go(A, `/manage/events/${cover}`); await shot(A, "02-cover-event");
  await browser.close(); await db.end(); console.log(`before screenshots written to ${SHOTS}`); process.exit(0);
}

// 1. Suggestions use the real operational window (event 09:00–12:00 + setup 08:15 + cleaning to 12:30).
await go(A, `/manage/events/${youth}`);
let t = await main(A);
check("event says when it needs a lead, including setup and clean-up (08:15–12:30)", t.includes("needs a site lead from 08:15–12:30"));
check("suggests the cover planned for the whole time", t.includes("Suggested: SYN FW Saturday cover, planned for the whole time") && t.includes("Linking isn't cover by itself"));
const opts = (await A.locator("select[name=coverage_event_id] option").allTextContents()).join(" | ");
check("the other cover option says exactly what it misses", opts.includes("SYN FW late cover") && opts.includes("misses 08:15–10:00"));
check("best fit is listed first", (await A.locator("select[name=coverage_event_id] option").nth(1).textContent())?.includes("SYN FW Saturday cover") ?? false);
await noOverflow(A, "event site cover");
await shot(A, "01-youth-site-cover");
await A.locator("select[name=coverage_event_id]").selectOption(cover);
await A.getByRole("button", { name: "Link" }).click();
await A.getByText("Currently linked to").waitFor();

// 2. Guided split on the cover event's site lead.
await go(A, `/manage/events/${cover}`);
const lead = A.locator("li[id^=shift-]", { hasText: "Site lead / duty manager" }).first();
await lead.getByText("Split into a handover (two site leads)").click();
await lead.locator("input[name=time]").fill("11:00");
t = ((await lead.textContent()) ?? "").replace(/\s+/g, " ");
const firstPart = t.slice(t.indexOf("First lead"), t.indexOf("Second lead"));
const secondPart = t.slice(t.indexOf("Second lead"), t.indexOf("Each lead needs"));
check("preview: first lead 08:00–11:00 opens up; second 11:00–14:00 locks up; checks on both",
  firstPart.startsWith("First lead: 08:00–11:00") && /open and unlock/i.test(firstPart) && /facility checks/i.test(firstPart) && !/lock and secure/i.test(firstPart) &&
  secondPart.startsWith("Second lead: 11:00–14:00") && /lock and secure/i.test(secondPart) && /facility checks/i.test(secondPart) && !/open and unlock/i.test(secondPart),
  t.slice(t.indexOf("First lead"), t.indexOf("First lead") + 220));
await noOverflow(A, "split preview");
await shot(A, "02-split-preview");
await lead.getByRole("button", { name: "Split into two site-lead duties" }).click();
await A.getByText("Split into two handover duties").waitFor();
const parts = await q<{ id: string; s: string; e: string }>(`select s.id, to_char(s.starts_at at time zone 'Europe/London', 'HH24:MI') as s, to_char(s.ends_at at time zone 'Europe/London', 'HH24:MI') as e
  from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'site_lead' and s.status = 'active' order by s.starts_at`, [cover]);
check("saved as two site-lead duties meeting at 11:00", parts.map((p) => `${p.s}–${p.e}`).join(",") === "08:00–11:00,11:00–14:00");
await shot(A, "03-after-split");

// 3. Only the first half filled → the linked event shows exactly the uncovered time.
await q(`do $$ declare v uuid; u uuid; begin
  insert into auth.users (email, email_confirmed_at) values ('opener@test.local', now()) returning id into u;
  insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at) values ('opener@test.local', 'Olly Opener', 'volunteer', now(), u, now()) returning id into v;
  insert into volunteer_duty_authorisations (volunteer_id, duty_type_id) select v, id from duty_types where code in ('site_lead', 'open_unlock');
  insert into assignments (shift_id, volunteer_id, status, source) values ('${parts[0].id}', v, 'confirmed', 'self_signup');
end $$;`);
await go(A, `/manage/events/${youth}`);
t = await main(A);
check("with only the opener confirmed, the event shows the gap 11:00–12:30", t.includes("Times with no confirmed site lead") && t.includes("11:00–12:30"));

// 4. Once someone is on a lead duty, splitting it is explained, not offered.
await go(A, `/manage/events/${cover}`);
const first = A.locator("li[id^=shift-]", { hasText: "Olly Opener" }).first();
await first.getByText("Split into a handover (two site leads)").click();
check("a lead duty with someone on it can't be split, and says why", ((await first.textContent()) ?? "").includes("Someone is already on this duty"));

// 5. A provider decision shows when it was recorded.
await go(A, `/manage/events/${await id("SYN FW late cover")}`);
await A.getByText("Record an external-cover decision (admin)").click();
await A.locator("select[name=source]").selectOption("provider_verified");
await A.fill("textarea[name=note]", "Synthetic: hall staff open and lock (confirmed by phone)");
await A.getByRole("button", { name: "Save decision" }).click();
await A.getByText("Recorded by an administrator on").waitFor();
check("provider decision shows its reason and when it was recorded", (await main(A)).includes("Synthetic: hall staff open and lock"));

// 6. New event: cover options say how well they fit the planned duties.
await go(A, "/manage/events/new");
await A.locator("select[name=venue_id]").selectOption({ label: "Freemens Way" });
await A.locator("input[name=date]").fill(D);
await A.locator("input[name=start]").fill("09:30");
await A.locator("input[name=end]").fill("11:30");
const newOpts = (await A.locator("select[name=coverage_event_id] option").allTextContents()).join(" | ");
check("new-event cover options are annotated with their fit", /SYN FW Saturday cover \(.*(covers the whole time|misses)/.test(newOpts), newOpts.slice(0, 200));

await browser.close();
await db.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
