/**
 * Phase 5 organiser checks at phone width: allocation → acceptance, approvals, late cancellations,
 * attendance, postpone → reconfirm, cancel, venue-lead loss warnings on every linked fixture,
 * provider cover shown distinctly, printable rota, volunteer admin, coordinator scope.
 *
 *   tests/e2e/run.sh tests/e2e/phase5-organiser.mts
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? "test-results/phase5";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };
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
const main = async (page: Page) => (await page.textContent("main")) ?? "";
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}
const shot = (page: Page, n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const statusOf = async (title: string, email: string, duty?: string) => (await q<{ status: string; attendance_status: string }>(
  `select a.status, a.attendance_status from assignments a join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id
   join duty_types d on d.id = s.duty_type_id join volunteers v on v.id = a.volunteer_id
   where e.title = $1 and v.email = $2 and ($3::text is null or d.code = $3) order by a.created_at desc limit 1`, [title, email, duty ?? null]))[0];
const eventId = async (title: string) => (await q<{ id: string }>("select id from events where title = $1", [title]))[0].id;
const shiftId = async (title: string, duty: string) => (await q<{ id: string }>(
  "select s.id from event_shifts s join events e on e.id = s.event_id join duty_types d on d.id = s.duty_type_id where e.title = $1 and d.code = $2 and s.status = 'active'", [title, duty]))[0].id;

// ---- Arrange extra Phase 5 situations directly in the test database --------------------------------
await q(`insert into assignments (shift_id, volunteer_id, status, source)
         values ($1, (select id from volunteers where email='filler@test.local'), 'pending_approval', 'self_signup')`, [await shiftId("E2E Sunday fixture", "gate_admissions")]);
await q(`insert into cancellation_requests (assignment_id, volunteer_id, reason)
         select a.id, a.volunteer_id, 'Car broke down' from assignments a join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id
         join volunteers v on v.id = a.volunteer_id where e.title = 'E2E Soon event' and v.email = 'vol@test.local'`);
await q(`do $$ declare e uuid; s uuid; begin
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values ((select id from venues where code='marke_wood'), 'E2E Yesterday event', 'fixture', now() - interval '26 hours', now() - interval '24 hours', 'published', false) returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code='cleaning'), now() - interval '24 hours', now() - interval '23 hours', 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, (select id from volunteers where email='vol@test.local'), 'confirmed', 'self_signup');
end $$;`);
// Other Person becomes the authorised, confirmed venue-wide lead for the DEMO Freemens Way Saturday.
await q(`insert into volunteer_duty_authorisations (volunteer_id, duty_type_id)
         select v.id, d.id from volunteers v, duty_types d where v.email = 'other@test.local' and d.code in ('site_lead','open_unlock','lock_secure')`);
await q(`insert into assignments (shift_id, volunteer_id, status, source) values ($1, (select id from volunteers where email='other@test.local'), 'confirmed', 'self_signup')`,
  [await shiftId("DEMO Freemens Way Saturday operations", "site_lead")]);
const [sat] = await q<{ day: string }>("select to_char((starts_at at time zone 'Europe/London')::date, 'YYYY-MM-DD') as day from events where title = 'DEMO Freemens Way Saturday operations'");

// =====================================================================================================
const admin = await phone("admin@test.local");
const vol = await phone("vol@test.local");
const A = admin.page, V = vol.page;

// 1. Needs action: approvals, late cancellations, unanswered invitations.
await open(A, "/manage/approvals", "Requests");
const na = await main(A);
check("needs-action lists a late cancellation with its reason", na.includes("Late cancellation requests (1)") && na.includes("Car broke down"));
check("needs-action lists the approval request", na.includes("Waiting for approval (1)") && na.includes("Filler Person"));
check("needs-action lists unanswered invitations (not counted as cover)", na.includes("Invitations not yet answered (2)"));
await noOverflow(A, "needs action"); await shot(A, "01-needs-action");
await A.locator("li", { hasText: "Filler Person" }).getByRole("button", { name: "Approve" }).click();
await A.getByText("Waiting for approval").waitFor({ state: "detached" });
check("approve → confirmed (saved)", (await statusOf("E2E Sunday fixture", "filler@test.local", "gate_admissions")).status === "confirmed");
await A.locator("li", { hasText: "Car broke down" }).getByRole("button", { name: "Let them cancel" }).click();
await A.getByText("Late cancellation requests").waitFor({ state: "detached" });
check("late cancellation accepted → withdrawn, place reopened", (await statusOf("E2E Soon event", "vol@test.local")).status === "withdrawn");

// 2. Allocation through the picker, then the volunteer accepts.
const sunday = await eventId("E2E Sunday fixture");
await open(A, `/manage/shifts/${await shiftId("E2E Sunday fixture", "general_support")}/assign`, "Invite a volunteer");
const pick = await main(A);
check("picker flags a clash for someone already on duty then", (await A.locator("li", { hasText: "Other Person" }).textContent())?.includes("Has another duty at this time") ?? false, pick.slice(0, 0));
await open(A, `/manage/shifts/${await shiftId("E2E Sunday fixture", "site_lead")}/assign`, "Invite a volunteer");
check("picker flags missing authorisation and offers no invite", ((await A.locator("li", { hasText: "Val Volunteer" }).textContent()) ?? "").includes("Needs authorisation") &&
  (await A.locator("li", { hasText: "Val Volunteer" }).getByRole("button", { name: "Invite" }).count()) === 0);
await open(A, `/manage/shifts/${await shiftId("E2E Sunday fixture", "pitch_setup")}/assign`, "Invite a volunteer");
await noOverflow(A, "invite page"); await shot(A, "02-invite-picker");
await A.locator("li", { hasText: "Val Volunteer" }).getByRole("button", { name: "Invite" }).click();
await A.locator("li", { hasText: "Val Volunteer" }).getByText("Already invited").waitFor();
check("invite → 'invited' (not counted as cover)", (await statusOf("E2E Sunday fixture", "vol@test.local", "pitch_setup")).status === "invited");
await open(V, "/my-duties?tab=invited", "My Duties");
await V.locator("li", { hasText: "E2E Sunday fixture" }).getByRole("button", { name: "Accept" }).click();
await V.getByText("Awaiting response (2)").waitFor();
check("volunteer accepts → confirmed", (await statusOf("E2E Sunday fixture", "vol@test.local", "pitch_setup")).status === "confirmed");
await open(A, `/manage/events/${sunday}`, "E2E Sunday fixture");
const ev = await main(A);
check("event page lists people per duty with status in words", ev.includes("Val Volunteer") && ev.includes("Confirmed"));
check("organisers see phone numbers of people on their duties", ev.includes("07700 900999"));
await noOverflow(A, "event page"); await shot(A, "03-event-people");

// 3. Attendance after the event, then complete.
const yesterday = await eventId("E2E Yesterday event");
await open(A, `/manage/events/${yesterday}`, "E2E Yesterday event");
await A.getByRole("button", { name: "Mark present" }).click();
await A.getByText("Attendance: Present").waitFor();
check("attendance marked present (saved)", (await statusOf("E2E Yesterday event", "vol@test.local")).attendance_status === "present");
await A.getByRole("button", { name: "Mark event completed" }).click();
await A.getByText("Marked as completed.").or(A.getByText("Completed", { exact: true })).first().waitFor();
check("event completed after its end", (await q<{ status: string }>("select status from events where id = $1", [yesterday]))[0].status === "completed");

// 4. Postpone → volunteers asked to reconfirm → republish → volunteer reconfirms.
const wd = await eventId("E2E Withdrawable duty event");
await open(A, `/manage/events/${wd}`, "E2E Withdrawable duty event");
await A.locator("form", { has: A.getByRole("button", { name: "Postpone event" }) }).locator("input[name=reason]").fill("Pitch unplayable");
await A.getByRole("button", { name: "Postpone event" }).click();
await A.getByText("Event postponed").waitFor();
check("postpone → event postponed and the volunteer reset to 'invited'",
  (await q<{ status: string }>("select status from events where id = $1", [wd]))[0].status === "postponed" &&
  (await statusOf("E2E Withdrawable duty event", "vol@test.local")).status === "invited");
const [msg] = await q<{ n: number }>("select count(*)::int as n from notification_outbox where kind = 'event_postponed'");
check("postponement queued a message to the volunteer", msg.n >= 1);
await A.getByRole("button", { name: "Publish event" }).click();
await A.waitForURL(/published=1/);
await open(V, "/my-duties?tab=invited", "My Duties");
check("volunteer sees the postponement and is asked to respond", ((await V.locator("li", { hasText: "E2E Withdrawable duty event" }).textContent()) ?? "").includes("Accept"));
await V.locator("li", { hasText: "E2E Withdrawable duty event" }).getByRole("button", { name: "Accept" }).click();
await V.locator("li", { hasText: "E2E Withdrawable duty event" }).waitFor({ state: "detached" }); // leaves the invitations tab
check("volunteer reconfirms → confirmed again", (await statusOf("E2E Withdrawable duty event", "vol@test.local")).status === "confirmed");

// 5. Cancel an event → volunteer sees it cancelled.
const inv = await eventId("E2E Invitation event");
await open(A, `/manage/events/${inv}`, "E2E Invitation event");
await A.locator("form", { has: A.getByRole("button", { name: "Cancel event" }) }).locator("input[name=reason]").fill("Hall unavailable");
await A.getByRole("button", { name: "Cancel event" }).click();
await A.getByText("Event cancelled").waitFor();
await open(V, "/my-duties", "My Duties");
check("volunteer is warned their duty was cancelled, with the reason", (await main(V)).includes("Duty cancelled") && (await main(V)).includes("Hall unavailable"));

// 6. Venue-wide lead: covered → lead removed → EVERY linked fixture at risk + alerts.
await open(A, `/manage/coverage?day=${sat.day}`, "Coverage");
let cov = await main(A);
check("with a confirmed venue lead, linked fixtures are not flagged", !cov.includes("DEMO U7/U9 youth fixture block") || !/Site lead missing or at risk \([1-9]/.test(cov.split("Duties needing")[0]) || !cov.split("Duties needing")[0].includes("DEMO U7/U9"));
const youth = await eventId("DEMO U7/U9 youth fixture block");
await open(A, `/manage/events/${youth}`, "DEMO U7/U9 youth fixture block");
check("linked fixture names the confirmed venue lead", ((await main(A)).match(/Other Person[\s\S]*Site lead confirmed[\s\S]*via DEMO Freemens Way Saturday operations/) ?? []).length > 0);
await shot(A, "04-linked-lead-named");
const cover = await eventId("DEMO Freemens Way Saturday operations");
await open(A, `/manage/events/${cover}`, "DEMO Freemens Way Saturday operations");
await A.getByText("Remove from duty").first().click();
await A.locator("form", { has: A.getByRole("button", { name: "Remove", exact: true }) }).locator("input[name=reason]").fill("Lead unwell");
await A.getByRole("button", { name: "Remove", exact: true }).click();
await A.getByText("No site lead yet").or(A.getByText("Nobody yet.")).first().waitFor();
await open(A, `/manage/coverage?day=${sat.day}`, "Coverage");
cov = await main(A);
const riskSection = cov.split("Duties needing")[0];
check("lead removed → BOTH linked activities listed as site lead at risk",
  riskSection.includes("DEMO U7/U9 youth fixture block") && riskSection.includes("DEMO Additional club activity"));
const alerts = await q<{ title: string }>(`select distinct e.title from notification_outbox o join events e on e.id = o.entity_id where o.kind = 'venue_cover_at_risk'`);
check("organisers alerted for every linked event", ["DEMO U7/U9 youth fixture block", "DEMO Additional club activity"].every((t) => alerts.some((a) => a.title === t)), alerts.map((a) => a.title).join(", "));
const [setupStill] = await q<{ n: number }>(`select count(*)::int as n from event_shifts s join events e on e.id = s.event_id where e.id = $1 and s.status = 'active'`, [youth]);
check("the fixtures' own duties are unchanged", setupStill.n === 2);
await noOverflow(A, "coverage"); await shot(A, "05-coverage-at-risk");

// 7. Provider cover is shown distinctly and never names a person.
const ft = await eventId("DEMO First Team v Example Town");
await open(A, `/manage/events/${ft}`, "DEMO First Team v Example Town");
await A.getByText("Record an external-cover decision (admin)").click();
await A.selectOption("select[name=source]", "provider_verified");
await A.fill("textarea[name=note]", "Leisure centre duty manager, confirmed by phone");
await A.getByRole("button", { name: "Save decision" }).click();
await A.getByText("Provider cover (admin-verified)").waitFor();
const ftText = await main(A);
check("provider cover is labelled as such, not as a named volunteer", ftText.includes("External provider") && ftText.includes("No volunteer is named for provider cover") && !ftText.includes("Site lead confirmed"));
await open(A, `/manage/coverage?day=${sat.day}`, "Coverage");
check("coverage page lists provider cover separately", (await main(A)).includes("Provider cover") && (await main(A)).includes("run by an external provider"));
await shot(A, "06-provider-cover");

// 8. Coverage counts distinguish confirmed / awaiting approval / invited.
await open(A, `/manage/coverage?day=${sat.day}&all=1`, "Coverage");
check("coverage shows confirmed/required and open places per duty", /\d+\/\d+ confirmed/.test(await main(A)) && (await main(A)).includes("open"));
const [sun] = await q<{ day: string }>("select to_char((starts_at at time zone 'Europe/London')::date, 'YYYY-MM-DD') as day from events where title = 'E2E Sunday fixture'");
await open(A, `/manage/coverage?day=${sun.day}`, "Coverage");
const chart = A.locator("table", { has: A.locator("caption", { hasText: "Expected volunteers on site by half hour at Marke Wood" }) });
const peak = Math.max(...(await chart.locator("tbody td span.tabular-nums").allTextContents()).map(Number));
check("expected-on-site chart is a real table with numbers (readable without colour)", (await chart.count()) === 1 && peak >= 2, `peak ${peak}`);

// 9. Printable day rota.
await open(A, `/manage/coverage/print?day=${sat.day}`, /volunteer rota for/);
const pr = await main(A);
check("print rota lists both venues, open places and the site-lead warning",
  pr.includes("Freemens Way") && pr.includes("Marke Wood") && pr.includes("(open)") && pr.includes("SITE LEAD NOT CONFIRMED"));
await A.emulateMedia({ media: "print" });
check("print hides the app header and menus", !(await A.locator("header").first().isVisible()) && !(await A.getByRole("navigation", { name: "Organiser" }).isVisible()));
await A.emulateMedia({ media: "screen" });
await shot(A, "07-print");

// 10. Volunteer admin: add + invite → they can sign in; grant authorisation; suspend.
await open(A, "/manage/volunteers", "Volunteers");
await A.fill("input[name=display_name]", "Nina New");
await A.fill("input[name=email]", "Nina.New@Test.Local");
await A.getByRole("button", { name: "Add and invite" }).click();
await A.getByText("Invitation emailed to nina.new@test.local").waitFor();
check("admin adds and invites a volunteer", (await q("select 1 from volunteers where email = 'nina.new@test.local' and invited_at is not null")).length === 1);
const nina = await phone("nina.new@test.local");
check("the invited volunteer can sign in", new URL(nina.page.url()).pathname === "/rota");
await nina.ctx.close();
await A.reload(); await A.getByRole("heading", { level: 1, name: "Volunteers" }).waitFor();
const valRow = A.locator("li", { hasText: "vol@test.local" });
await valRow.getByText("Manage access").click();
const leadForm = valRow.locator("form", { hasText: "Site lead / duty manager" });
await leadForm.getByLabel("Site lead / duty manager").check();
await leadForm.locator("input[name=valid_until]").fill("2030-12-31");
await leadForm.getByRole("button", { name: "Save" }).click();
await valRow.getByText("Authorised for: Site lead / duty manager").waitFor();
check("admin grants a dated club authorisation", (await q("select 1 from volunteer_duty_authorisations a join volunteers v on v.id = a.volunteer_id join duty_types d on d.id = a.duty_type_id where v.email='vol@test.local' and d.code='site_lead' and a.active and a.valid_until is not null")).length === 1);
const ninaRow = A.locator("li", { hasText: "nina.new@test.local" });
await ninaRow.getByText("Manage access").click();
await ninaRow.getByLabel("Active").uncheck();
await ninaRow.getByRole("button", { name: "Save access" }).click();
await ninaRow.waitFor({ state: "detached" }); // leaves the default "Active" list
await open(A, "/manage/volunteers?show=suspended", "Volunteers");
await A.locator("li", { hasText: "nina.new@test.local" }).getByText("Suspended", { exact: true }).waitFor();
check("admin suspends a volunteer", (await q<{ is_active: boolean }>("select is_active from volunteers where email = 'nina.new@test.local'"))[0].is_active === false);
await noOverflow(A, "volunteers"); await shot(A, "08-volunteers");

// 11. Coordinator (Freemens Way only) scope.
const coord = await phone("coord@test.local");
const C = coord.page;
await open(C, "/manage/approvals", "Requests");
check("coordinator's needs-action excludes the other venue", !(await main(C)).includes("Marke Wood"));
await C.goto(`${APP}/manage/shifts/${await shiftId("E2E Sunday fixture", "pitch_setup")}/assign`);
await C.getByRole("heading", { level: 1, name: "Not found" }).waitFor();
check("coordinator cannot open the invite page for another venue's duty", true);
await open(C, "/manage/volunteers", "Volunteers");
const cv = await main(C);
check("coordinator sees no 'Add a volunteer' and no access controls", !cv.includes("Add a volunteer") && !cv.includes("Manage access"));
check("coordinator sees only people on their venue's duties", !cv.includes("vol@test.local"), "Val is only on Marke Wood duties");
await open(C, `/manage/coverage/print?day=${sat.day}`, /volunteer rota for/);
check("coordinator's printed rota excludes the other venue", !(await main(C)).includes("Marke Wood"));
await coord.ctx.close();

// 12. Volunteers can't reach organiser tools.
for (const path of ["/manage/coverage", "/manage/approvals", "/manage/volunteers", `/manage/coverage/print?day=${sat.day}`]) {
  await V.goto(`${APP}${path}`);
  await V.waitForURL(/\/rota$/, { timeout: 10_000 }).catch(() => {});
  check(`volunteer is turned away from ${path.split("?")[0]}`, new URL(V.url()).pathname === "/rota");
}

await admin.ctx.close(); await vol.ctx.close();
await browser.close(); await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
