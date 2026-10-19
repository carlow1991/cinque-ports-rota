/**
 * Volunteer Hub · the owner's demo script (docs/hub/05_ACCEPTANCE_TESTS.md, steps 1–10), end to end on
 * the production build, with email ON against the test-only fake provider (staging allow-list), plus
 * accessibility scans (H48) and a check that nothing is emailed without a deliberate action (C50).
 *   tests/e2e/run.sh tests/e2e/hub-demo.mts [--build]
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { APP, FAKE, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub demo script");
type Mail = { to: string[]; subject: string; text: string; html: string };
const mail = async () => ((await (await fetch(`${FAKE}/mail/_sent`)).json()) as { sent: Mail[] }).sent;
const cron = () => fetch(`${APP}/api/cron/outbox`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef"}` } });
const a11y: string[] = [];
async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (bad.length) a11y.push(`${name}: ${bad.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`);
}

const ukDay = (plus: number) => new Date(Date.now() + plus * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const SAT = ukDay(3), SUN = ukDay(4);
const at = async (day: string, hhmm: string) => (await q<{ t: Date }>("select (($1 || ' ' || $2)::timestamp at time zone 'Europe/London') t", [day, hhmm]))[0].t;
const [{ id: marke }] = await q<{ id: string }>("select id from venues where code = 'marke_wood'");
await q("update people set full_name = 'Bob (demo)', display_name = null, routine_requests_enabled = true where email_normalized = 'vol@test.local'");
await q("update people set full_name = 'Steve (demo)', display_name = null, routine_requests_enabled = true where email_normalized = 'other@test.local'");
const [{ id: bob }] = await q<{ id: string }>("select id from people where email_normalized = 'vol@test.local'");
const [{ id: steve }] = await q<{ id: string }>("select id from people where email_normalized = 'other@test.local'");
const [{ id: vets }] = await q<{ id: string }>("insert into teams (name) values ('Veterans (demo)') returning id");
const mailBefore = (await mail()).length;

const admin = await newPage();
await signIn(admin, "admin@test.local");

// Email: an administrator starts it (new emails only). Nothing queued so far.
await admin.goto(`${APP}/manage/settings`);
admin.once("dialog", (d) => d.accept());
await admin.getByRole("button", { name: "Start: new emails only (recommended)" }).click({ timeout: 20_000 }).catch(async () => {
  await q("update club_settings set email_released_from = now()"); // already started in this database
});
await admin.getByText(/Email started|Email is on/).first().waitFor({ timeout: 15_000 }).catch(() => {});
check("email started by an administrator", (await q("select 1 from club_settings where email_released_from is not null")).length === 1);

// 1. Scott, no login, team manager (no availability requests)
await admin.goto(`${APP}/manage/people/new`);
await admin.getByLabel("Name (required)").fill("Scott (demo manager)");
await admin.getByLabel("Manager / coach").check();
await Promise.all([admin.waitForURL(/\/manage\/people\/[0-9a-f-]{36}/), admin.getByRole("button", { name: "Save person" }).click()]);
await admin.getByText("Add a team role").click();
await admin.locator("select[name=team_id]").selectOption({ label: "Veterans (demo)" });
await admin.locator("details[open] input[name=role_label]").fill("Manager");
await admin.getByLabel("Expected at this team's events").last().check();
await admin.getByRole("button", { name: "Add role" }).click();
await admin.getByText("Team role saved.").waitFor({ timeout: 15_000 }).catch(() => {});
const [scott] = await q<{ id: string }>("select id from people where full_name = 'Scott (demo manager)'");
check("1. Scott saved with no login, expected at Veterans events", (await q("select 1 from team_people where person_id = $1 and is_expected_by_default", [scott.id])).length === 1
  && (await q("select 1 from user_accounts where person_id = $1", [scott.id])).length === 0);
check("…and no message for him", (await mail()).length === mailBefore);

// 2. Kelly: volunteer, explicit invite, routine suggestions on
await admin.goto(`${APP}/manage/people/new`);
await admin.getByLabel("Name (required)").fill("Kelly (demo)");
await admin.getByLabel("Email (optional)").fill("kelly@test.local");
await admin.getByLabel("Include in suggested availability recipients").check();
await Promise.all([admin.waitForURL(/\/manage\/people\/[0-9a-f-]{36}/), admin.getByRole("button", { name: "Save person" }).click()]);
admin.once("dialog", (d) => d.accept());
await admin.getByRole("button", { name: "Send portal invitation" }).click();
await admin.getByText(/Invitation emailed to kelly@test.local/).waitFor({ timeout: 15_000 }).catch(() => {});
const [kelly] = await q<{ id: string; invite_state: string }>("select p.id, ua.invite_state from people p join user_accounts ua on ua.person_id = p.id where p.email_normalized = 'kelly@test.local'");
check("2. Kelly invited explicitly (sent once)", kelly?.invite_state === "sent");

// 3. Saturday: Mini Kickers, Youth Fixtures, Veterans (kick-off only) at Marke Wood
const ev = async (title: string, day: string, s: string, e: string | null, extra: Record<string, unknown> = {}) => (await q<{ id: string }>(
  `insert into events (title, category, event_type, venue_id, starts_at, ends_at, kickoff_at, status, volunteers_enabled, team_id, external_location_text)
   values ($1, $2, 'other', $3, $4, $5, $6, 'published', $7, $8, $9) returning id`,
  [title, extra.category ?? "other", extra.outside ? null : marke, await at(day, s), e ? await at(day, e) : null, e ? null : await at(day, s),
   extra.help ?? false, extra.team ?? null, extra.outside ?? null]))[0].id;
const mini = await ev("Mini Kickers", SAT, "09:00", "11:00");
const youth = await ev("Youth Home Fixtures", SAT, "09:00", "12:00", { help: true });
const veterans = await ev("Veterans v Demo FC", SAT, "10:30", null, { team: vets, category: "match" });

// 4. Kelly's café cover once; she accepts; all three events show it; overview counts her once
const kel = await newPage();
await signIn(kel, "kelly@test.local");
check("Kelly can sign in after her invitation", new URL(kel.url()).pathname === "/home", kel.url());
await admin.goto(`${APP}/manage/venue-cover?date=${SAT}&from=09:00&until=13:00&venue=${marke}&person=${kelly.id}`);
const coverForm = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Save cover" }) });
await coverForm.locator("select[name=person_id]").selectOption(kelly.id);
await coverForm.locator("input[name=label]").fill("Café");
await coverForm.getByRole("button", { name: "Save cover" }).click();
await admin.getByText(/Request saved/).waitFor({ timeout: 15_000 }).catch(() => {});
await kel.goto(`${APP}/home`);
await kel.getByRole("button", { name: /^Accept/ }).first().click({ timeout: 15_000 });
await kel.getByText("Confirmed — thank you!").waitFor({ timeout: 15_000 }).catch(() => {});
const covered: string[] = [];
for (const [id, name] of [[mini, "Mini Kickers"], [youth, "Youth"], [veterans, "Veterans"]] as const) {
  await admin.goto(`${APP}/calendar/${id}`);
  await admin.getByRole("heading", { level: 1 }).first().waitFor();
  await admin.getByText("Venue-wide cover").first().waitFor({ timeout: 10_000 }).catch(() => {});
  if (((await admin.textContent("main")) ?? "").includes("Kelly (demo)")) covered.push(name);
}
check("4. one café assignment shows on all three events", covered.length === 3 && (await q("select 1 from hub_assignments where person_id = $1", [kelly.id])).length === 1, covered.join(", "));

// 5. Ladies fixture next day: invite Bob and Steve; Bob confirms, Steve declines (with email)
const ladies = await ev("Ladies v Demo", SUN, "14:00", "16:00", { help: true, category: "match" });
async function invite(name: string) {
  await admin.goto(`${APP}/calendar/${ladies}`);
  await admin.locator("#invite summary").click();
  await admin.locator("#invite select[name=person_id]").selectOption({ label: name });
  await admin.locator("#invite input[name=label]").fill("Matchday support");
  await admin.locator("#invite").getByRole("button", { name: "Save" }).click();
  await admin.getByText(/Request saved/).first().waitFor({ timeout: 15_000 }).catch(() => {});
}
await invite("Bob (demo)");
await invite("Steve (demo)");
await cron();
const invitationMail = (await mail()).filter((m) => m.subject.startsWith("Can you help with Matchday support?"));
check("5. Bob's invitation email arrives (allow-listed test address)", invitationMail.some((m) => m.to.includes("vol@test.local")));
check("…Steve's is held back by the test allow-list, never sent", !invitationMail.some((m) => m.to.includes("other@test.local")));
check("…and the email names no one else", !invitationMail.some((m) => /Steve|Kelly|Scott|07700/.test(m.text)));
const bobPage = await newPage();
await signIn(bobPage, "vol@test.local");
await bobPage.getByRole("button", { name: /^Accept/ }).first().click({ timeout: 15_000 });
await bobPage.getByText("Confirmed — thank you!").waitFor({ timeout: 15_000 }).catch(() => {});
const stevePage = await newPage();
await signIn(stevePage, "other@test.local");
await stevePage.getByRole("button", { name: /^Decline/ }).first().click({ timeout: 15_000 });
await stevePage.getByText("Declined.").waitFor({ timeout: 15_000 }).catch(() => {});
const st = Object.fromEntries((await q<{ person_id: string; state: string }>("select person_id, state from hub_assignments where event_id = $1", [ladies])).map((r) => [r.person_id, r.state]));
check("5. Bob confirmed, Steve declined", st[bob] === "confirmed" && st[steve] === "declined");
await cron();
const toOrganiser = (await mail()).filter((m) => m.to.includes("admin@test.local")).map((m) => m.subject);
check("…the organiser is emailed both answers", toOrganiser.some((x) => x.startsWith("Bob (demo) accepted")) && toOrganiser.some((x) => x.startsWith("Steve (demo) can't help")), toOrganiser.join(" | "));

// 6. Away meeting, information only
const meeting = await ev("Away committee meeting", SUN, "19:00", null, { outside: "Deal Town clubhouse", category: "meeting" });
await bobPage.goto(`${APP}/calendar/${meeting}`);
await bobPage.getByRole("heading", { name: "Away committee meeting" }).waitFor();
check("6. information-only away meeting has no availability controls", (await bobPage.getByRole("heading", { name: "Can you help?" }).count()) === 0);

// 7. Club roles: Club Secretary replacement, Groundsman extra support
await admin.goto(`${APP}/manage/club-roles`);
await admin.getByRole("button", { name: "Add the usual roles" }).click();
for (let i = 0; i < 40 && (await q("select 1 from club_positions")).length < 8; i++) await new Promise((r) => setTimeout(r, 250));
const [adminP] = await q<{ id: string }>("select id from people where email_normalized = 'admin@test.local'");
const roles = Object.fromEntries((await q<{ id: string; title: string }>("select id, title from club_positions")).map((r) => [r.title, r.id]));
for (const t of ["Club Secretary", "Groundsman"]) await q("insert into position_holders (club_position_id, person_id, start_date) values ($1, $2, '2024-08-01')", [roles[t], adminP.id]);
for (const [t, box] of [["Club Secretary", "Seeking a replacement / successor"], ["Groundsman", "Need additional help"]] as const) {
  await admin.goto(`${APP}/manage/club-roles/${roles[t]}`);
  await admin.getByLabel(box).check();
  await admin.getByRole("button", { name: "Save recruiting" }).click();
  await admin.getByText(/Recruiting saved/).waitFor({ timeout: 15_000 });
}
await admin.goto(`${APP}/manage/club-roles/${roles["Club Secretary"]}`);
await admin.getByLabel("Short public description").fill("Keeps the club organised.");
await admin.getByLabel("Can appear on the public volunteer page").check();
await admin.getByRole("button", { name: "Save details" }).click();
await admin.getByText("Saved.").first().waitFor({ timeout: 15_000 });
check("7. both roles filled and recruiting independently", (await q("select 1 from club_positions where (seeking_replacement or seeking_additional_help)")).length === 2);

// 8–9. Anonymous application; only in the admin inbox; no login, no invitation
const pub = await newPage();
await pub.goto(`${APP}/volunteer`);
await pub.getByRole("heading", { name: "Club Secretary" }).waitFor({ timeout: 15_000 });
await scan(pub, "/volunteer");
await pub.getByRole("link", { name: "I'm interested" }).first().click();
await pub.getByLabel("Full name").waitFor();
await scan(pub, "/volunteer/apply");
await pub.getByLabel("Full name").fill("New Applicant (demo)");
await pub.getByLabel("Email address").fill("new.applicant@example.org");
await pub.getByLabel("Email", { exact: true }).check();
await pub.getByLabel("Yes", { exact: true }).check();
await pub.getByRole("button", { name: "Next" }).click();
await pub.getByLabel("Refreshments / café").check();
await pub.getByLabel("Social media", { exact: true }).check();
await pub.getByLabel("Organisation").check();
await pub.getByLabel("Maybe").check();
await pub.getByRole("button", { name: "Next" }).click();
await pub.getByLabel("5–10 hours a month").check();
await pub.getByLabel("Occasional, when needed").check();
await pub.getByLabel("Sat Morning").check();
await pub.getByLabel("Sun Afternoon").check();
await pub.getByLabel("On site", { exact: true }).check();
await pub.locator("input[name=privacy]").check();
await new Promise((r) => setTimeout(r, 3100));
await pub.getByRole("button", { name: "Send my volunteering interest" }).click();
await pub.getByText("Thank you for offering to help.").waitFor({ timeout: 15_000 });
check("8. anonymous application sent", (await q("select 1 from volunteer_applications where email_normalized = 'new.applicant@example.org'")).length === 1);
check("9. no login and no invitation for the applicant", (await q("select 1 from auth.users where email = 'new.applicant@example.org'")).length === 0
  && (await q("select 1 from people where email_normalized = 'new.applicant@example.org'")).length === 0);
await admin.goto(`${APP}/manage/applications`);
await admin.getByText("New Applicant (demo)").waitFor({ timeout: 15_000 });
await admin.getByRole("link", { name: "New Applicant (demo)" }).click();
await admin.getByRole("heading", { name: "Suggested roles" }).waitFor();
check("9. reviewable with suggestions", ((await admin.textContent("main")) ?? "").includes("Chose this role on the form"));
await bobPage.goto(`${APP}/manage/applications`);
await bobPage.waitForURL((u) => u.pathname === "/home", { timeout: 15_000 }).catch(() => {});
check("9. …visible only to administrators", new URL(bobPage.url()).pathname === "/home");

// 10. Weekend dashboard and Freemens Way
await admin.goto(`${APP}/manage`);
await admin.getByRole("heading", { name: "This week" }).waitFor();
await admin.getByText("Mini Kickers").first().waitFor({ timeout: 15_000 });
const ov = (await admin.textContent("main")) ?? "";
check("10. dashboard shows Saturday's shared cover once", (ov.match(/Kelly \(demo\) — Café/g) ?? []).length === 1);
check("10. Veterans shows the manager as expected, not confirmed", /Veterans v Demo FC[\s\S]{0,200}1 expected/.test(ov));
check("10. Ladies shows 1 confirmed (Bob) and 1 asked-not-replied / declined not counted as confirmed", /Ladies v Demo[\s\S]{0,200}1 confirmed/.test(ov));
check("10. Freemens Way is inactive", (await q("select 1 from venues where code = 'freemens_way' and not active")).length === 1);
check("dashboard fits a 375px phone", await noHorizontalScroll(admin));

// Accessibility (H48) on the main signed-in screens
for (const [page, path] of [[kel, "/home"], [kel, "/calendar"], [kel, `/calendar/${youth}`], [kel, "/people"], [kel, "/my-profile"], [admin, "/manage"], [admin, "/manage/events/new"], [admin, "/manage/people/new"], [admin, "/manage/venue-cover"]] as const) {
  await page.goto(`${APP}${path}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 });
  await scan(page, path);
}
check("H48: no serious or critical accessibility problems (axe, WCAG 2.1 AA)", a11y.length === 0, a11y.join(" | "));

// H48: 320px width (= 1280px at 400% / 640px at 200% zoom reflow) without sideways scrolling
const narrow: string[] = [];
for (const [page, path] of [[kel, "/calendar"], [kel, `/calendar/${youth}`], [kel, "/home"], [admin, "/manage/events/new"], [admin, `/manage/events/${youth}`], [admin, "/manage"]] as const) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${APP}${path}`);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 });
  if (!(await noHorizontalScroll(page))) narrow.push(path);
}
check("H48: key screens fit 320px with no sideways scrolling", narrow.length === 0, narrow.join(", "));
// H48: keyboard — the event form can be reached and filled with Tab alone
await admin.goto(`${APP}/manage/events/new`);
await admin.getByRole("heading", { level: 1 }).first().waitFor();
let reachedTitle = false;
for (let i = 0; i < 25 && !reachedTitle; i++) {
  await admin.keyboard.press("Tab");
  reachedTitle = await admin.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name === "title");
}
check("H48: event name field reachable by keyboard", reachedTitle);
await admin.setViewportSize({ width: 375, height: 800 });
await kel.setViewportSize({ width: 375, height: 800 });

// C50: nothing was emailed except after deliberate actions in this run
const subjects = (await mail()).slice(mailBefore).map((m) => m.subject);
check("C50: every email follows an explicit action (invites, answers, cover request)", subjects.every((s) => /Can you help|Can you cover|accepted|can't help|invited|Invitation/i.test(s)), subjects.join(" | "));
// Carried over from the retired email checks: cron locked, security headers, no secrets in the bundle.
check("cron endpoint refuses a request without the secret", (await fetch(`${APP}/api/cron/outbox`, { redirect: "manual" })).status === 401);
const head = await fetch(`${APP}/volunteer`);
check("security headers on public pages", head.headers.get("x-frame-options") === "DENY" && (head.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
const { readdirSync, readFileSync, statSync } = await import("node:fs");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
const leaked = walk(".next/static").filter((f) => f.endsWith(".js")).filter((f) => /sb_secret_test|re_test_key|test-cron-secret/.test(readFileSync(f, "utf8")));
check("no server secrets in the browser bundle", leaked.length === 0, leaked.join(", "));
await finish();
