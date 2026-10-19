/**
 * Phase 4 volunteer usability checks at phone width (375×812), keyboard and privacy included.
 * Runs against the test-only fake Supabase (real Postgres + RLS) and a production build.
 *
 *   APP_URL=http://localhost:3200 DB_URL=postgresql://… node tests/e2e/phase4-volunteer.mts
 */
import { mkdirSync } from "node:fs";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const SHOTS = process.env.SHOTS ?? "test-results/phase4";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => {
  results.push({ check: name, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`);
};
const browser = await chromium.launch();

async function newPhone(): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept()); // accept "Are you sure?" confirmations
  return { ctx, page };
}
async function signIn(page: Page, email: string) {
  await page.goto(`${APP}/login`);
  await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.fill("#code", "000000");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
}
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const dutyCard = (page: Page, duty: string) => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: duty, level: 3 }) });
const mainText = async (page: Page) => (await page.textContent("main")) ?? "";
/** Pages stream their content in after the shell; wait for the page's own heading before reading it. */
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(`${APP}${path}`);
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
}

const [sunday] = await q<{ id: string }>("select id from events where title = 'E2E Sunday fixture'");
const [draft] = await q<{ id: string }>("select id from events where title = 'E2E Secret draft'");

// ---------------------------------------------------------------------------------------------
// 1. A volunteer signs in and takes a duty on a phone in under a minute.
// ---------------------------------------------------------------------------------------------
const { ctx, page } = await newPhone();
const t0 = Date.now();
await signIn(page, "vol@test.local");
await page.getByRole("link", { name: /^\d\d:\d\d–\d\d:\d\d.*E2E Sunday fixture/ }).click();
await page.waitForURL(/\/rota\/[0-9a-f-]{36}/);
const before = await mainText(page);
check("before joining the event, other volunteers' names are not shown", !before.includes("Other Person"));
await dutyCard(page, "Pitch and equipment setup").getByRole("button", { name: /^Take this duty/ }).click();
await dutyCard(page, "Pitch and equipment setup").getByText("You're confirmed").waitFor();
const elapsed = (Date.now() - t0) / 1000;
const [setupRow] = await q<{ status: string }>(
  `select a.status from assignments a join event_shifts s on s.id = a.shift_id join duty_types d on d.id = s.duty_type_id
   join volunteers v on v.id = a.volunteer_id where s.event_id = $1 and d.code = 'pitch_setup' and v.email = 'vol@test.local'`, [sunday.id]);
check("sign-in → open event → sign up takes under 1 minute", elapsed < 60, `${elapsed.toFixed(1)} s with automation; 5 taps + 2 fields`);
check("'confirmed' shown only after the database committed it", setupRow?.status === "confirmed");
await shot(page, "01-event-after-signup");
await noOverflow(page, "event page");

// 2. Privacy: names only, only once on the event; never email or phone.
const after = await mainText(page);
check("once on the event, confirmed names are visible", after.includes("Other Person"));
const html = await page.content();
check("no other volunteer's email or phone anywhere in the page", !html.includes("other@test.local") && !html.includes("07700 900999") && !html.includes("filler@test.local"));

// 3. Clear reasons when a duty can't be taken.
check("full duty says Full", (await dutyCard(page, "Post-event cleaning").textContent())?.includes("Full") ?? false);
check("restricted duty explains the club authorisation", (await dutyCard(page, "Site lead / duty manager").textContent())?.includes("Needs a club authorisation") ?? false);
check("clashing duty explains the overlap", (await dutyCard(page, "General volunteer support").textContent())?.includes("already have a duty at this time") ?? false);

// 4. Last place taken by someone else after the page loaded → explicit message, no fake success.
await q(
  `insert into assignments (shift_id, volunteer_id, status, source)
   select s.id, (select id from volunteers where email = 'filler@test.local'), 'confirmed', 'self_signup'
   from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'refreshments'`, [sunday.id]);
await dutyCard(page, "Refreshments / tea bar").getByRole("button", { name: /^Take this duty/ }).click();
await dutyCard(page, "Refreshments / tea bar").getByRole("alert").waitFor();
const fullMsg = (await dutyCard(page, "Refreshments / tea bar").getByRole("alert").textContent()) ?? "";
check("race lost: 'Shift now full; please contact the organiser'", /Shift now full; please contact the organiser/.test(fullMsg), fullMsg);
const [refresh] = await q<{ n: number }>(
  `select count(*)::int as n from assignments a join event_shifts s on s.id = a.shift_id join duty_types d on d.id = s.duty_type_id
   join volunteers v on v.id = a.volunteer_id where s.event_id = $1 and d.code = 'refreshments' and v.email = 'vol@test.local'`, [sunday.id]);
check("nothing was saved for the lost race", refresh.n === 0);

// 5. Approval-required duty, operated by KEYBOARD only.
const gateBtn = dutyCard(page, "Gate / admission collection").getByRole("button", { name: /^Request this duty/ });
await gateBtn.focus();
await page.keyboard.press("Enter");
await dutyCard(page, "Gate / admission collection").getByText("Awaiting organiser approval").waitFor();
const [gate] = await q<{ status: string }>(
  `select a.status from assignments a join event_shifts s on s.id = a.shift_id join duty_types d on d.id = s.duty_type_id
   join volunteers v on v.id = a.volunteer_id where s.event_id = $1 and d.code = 'gate_admissions' and v.email = 'vol@test.local'`, [sunday.id]);
check("keyboard-only 'Request this duty' → pending approval (place held)", gate?.status === "pending_approval");

// 6. Rota list.
await page.getByRole("link", { name: "Rota", exact: true }).click();
await page.waitForURL(/\/rota$/);
await page.getByRole("heading", { level: 1, name: "Rota" }).waitFor();
await page.getByText("E2E Sunday fixture").first().waitFor(); // the list itself has rendered
const rota = await mainText(page);
check("rota lists published events (sanity: content really loaded)", rota.includes("E2E Sunday fixture") && rota.includes("E2E Invitation event"));
check("rota hides drafts", !rota.includes("E2E Secret draft"));
check("rota marks events I'm on, in words not just colour", rota.includes("You're on this"));
check("rota shows how many places I can take", /places? you can take/.test(rota));
await noOverflow(page, "rota"); await shot(page, "02-rota");
await page.getByRole("navigation", { name: "Venue" }).getByRole("link", { name: "Freemens Way" }).click();
await page.locator('nav[aria-label="Venue"] a[aria-current="page"]', { hasText: "Freemens Way" }).waitFor();
const fwTitles = await page.locator("main a[href^='/rota/'] p.font-semibold").allTextContents();
check("venue tab filters to that venue", fwTitles.length > 0 && !fwTitles.includes("E2E Sunday fixture"), fwTitles.join(" | "));
await open(page, `/rota/${draft.id}`, "Not found");
check("a draft event URL shows 'Not found' and none of its details", !(await mainText(page)).includes("E2E Secret draft"));

// 7. My Duties: invitations first; accept one, decline one.
await open(page, "/my-duties", "My Duties");
const md = await mainText(page);
check("My Duties opens on 'Awaiting response' when invitations wait", md.includes("Awaiting response (2)") && md.includes("An organiser has asked"));
await noOverflow(page, "my duties"); await shot(page, "03-my-duties-invites");
const inviteItems = page.locator("li", { hasText: "E2E Invitation event" });
await inviteItems.filter({ hasText: "Refreshments" }).getByRole("button", { name: "Accept" }).click();
await page.getByText("Awaiting response (1)").waitFor();
await inviteItems.filter({ hasText: "Post-event cleaning" }).getByRole("button", { name: "Decline" }).click();
await page.getByText("Awaiting response (0)").waitFor();
const inv = await q<{ code: string; status: string }>(
  `select d.code, a.status from assignments a join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id
   join duty_types d on d.id = s.duty_type_id join volunteers v on v.id = a.volunteer_id
   where e.title = 'E2E Invitation event' and v.email = 'vol@test.local' order by d.code`);
check("accept → confirmed, decline → declined (saved)", JSON.stringify(inv) === JSON.stringify([{ code: "cleaning", status: "declined" }, { code: "refreshments", status: "confirmed" }]), JSON.stringify(inv));

// 8. Withdraw before the cut-off.
await open(page, "/my-duties?tab=confirmed", "My Duties");
const withdrawable = page.locator("li", { hasText: "E2E Withdrawable duty event" });
check("withdrawal deadline is shown", ((await withdrawable.textContent()) ?? "").includes("You can withdraw online until"));
await withdrawable.getByRole("button", { name: "Withdraw from this duty" }).click();
await page.locator("li", { hasText: "E2E Withdrawable duty event" }).waitFor({ state: "detached" });
const [wd] = await q<{ status: string }>(
  `select a.status from assignments a join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id
   join volunteers v on v.id = a.volunteer_id where e.title = 'E2E Withdrawable duty event' and v.email = 'vol@test.local'`);
check("withdraw before cut-off → withdrawn, place reopened", wd.status === "withdrawn");

// 9. Inside the cut-off: only a cancellation REQUEST, cover kept.
const soon = page.locator("li", { hasText: "E2E Soon event" });
check("inside cut-off there is no withdraw button", (await soon.getByRole("button", { name: "Withdraw from this duty" }).count()) === 0);
await soon.getByText("Can't make it?").click();
await soon.locator("textarea[name=reason]").fill("Car broke down");
await soon.getByRole("button", { name: "Ask to cancel" }).click();
await page.locator("li", { hasText: "E2E Soon event" }).getByText("You've asked to cancel").waitFor();
const [late] = await q<{ status: string; req: string }>(
  `select a.status, cr.status as req from assignments a join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id
   join volunteers v on v.id = a.volunteer_id join cancellation_requests cr on cr.assignment_id = a.id
   where e.title = 'E2E Soon event' and v.email = 'vol@test.local'`);
check("late cancellation is a pending request; still confirmed until an organiser acts", late?.status === "confirmed" && late?.req === "pending");
await shot(page, "04-my-duties-confirmed");

// 10. Calendar file for my own duty; someone else's is not found.
const [mine] = await q<{ id: string }>(
  `select a.id from assignments a join volunteers v on v.id = a.volunteer_id join event_shifts s on s.id = a.shift_id
   join events e on e.id = s.event_id where v.email = 'vol@test.local' and e.title = 'E2E Sunday fixture' and a.status = 'confirmed'`);
const [theirs] = await q<{ id: string }>(`select a.id from assignments a join volunteers v on v.id = a.volunteer_id where v.email = 'other@test.local' limit 1`);
const ics = await page.request.get(`${APP}/my-duties/${mine.id}/calendar`);
const icsBody = await ics.text();
check("calendar file for my duty", ics.status() === 200 && (ics.headers()["content-type"] ?? "").includes("text/calendar") && icsBody.includes("BEGIN:VEVENT"));
check("calendar file for someone else's duty → not found", (await page.request.get(`${APP}/my-duties/${theirs.id}/calendar`)).status() === 404);

// 11. Past tab.
await open(page, "/my-duties?tab=past", "My Duties");
check("past duties show attendance", (await mainText(page)).includes("Marked as attended"));

// 12. Profile: validation and save.
await page.getByRole("link", { name: "Profile", exact: true }).click();
await page.getByRole("heading", { level: 1, name: "Profile" }).waitFor();
await noOverflow(page, "profile");
await page.fill("input[name=phone]", "call me maybe");
await page.getByRole("button", { name: "Save" }).click();
await page.locator("main [role=alert]").first().waitFor();
check("invalid phone gets a plain-English error", ((await page.locator("main [role=alert]").first().textContent()) ?? "").includes("Use digits"));
await page.fill("input[name=display_name]", "Val V");
await page.fill("input[name=phone]", "07700 900123");
await page.getByRole("button", { name: "Save" }).click();
await page.getByText("Profile saved.").waitFor();
const [prof] = await q<{ display_name: string; phone: string }>("select display_name, phone from volunteers where email = 'vol@test.local'");
check("profile saved to the database", prof.display_name === "Val V" && prof.phone === "07700 900123");
await shot(page, "05-profile");

// 13. Accessibility basics on each screen: every button and link has an accessible name; one h1.
for (const [path, h1] of [["/rota", "Rota"], [`/rota/${sunday.id}`, "E2E Sunday fixture"], ["/my-duties", "My Duties"], ["/profile", "Profile"]] as const) {
  await open(page, path, h1);
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea").forEach((el) => {
      const h = el as HTMLElement;
      // textContent (not innerText) so controls inside a collapsed <details> panel are still checked.
      const name = (h.getAttribute("aria-label") || h.textContent || (h as HTMLInputElement).labels?.[0]?.textContent || h.getAttribute("title") || "").trim();
      if (!name) out.push(h.outerHTML.slice(0, 80));
    });
    if (document.querySelectorAll("h1").length !== 1) out.push(`h1 count ${document.querySelectorAll("h1").length}`);
    return out;
  });
  check(`${path}: every control is labelled; exactly one h1`, problems.length === 0, problems.join(" | "));
}

// 14. Suspended mid-session loses access on the next page load.
await q("update volunteers set is_active = false where email = 'vol@test.local'");
await page.goto(`${APP}/rota`);
await page.waitForURL(/\/no-access$/, { timeout: 10_000 }).catch(() => {});
check("suspended volunteer is shut out immediately", new URL(page.url()).pathname === "/no-access" && !(await page.content()).includes("E2E Sunday fixture"));
await q("update volunteers set is_active = true where email = 'vol@test.local'");
await ctx.close();

await browser.close();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
