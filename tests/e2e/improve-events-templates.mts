/**
 * Improvement increment 5 (event page layout, creation, templates) at phone width, synthetic data only.
 *
 *   tests/e2e/run.sh tests/e2e/improve-events-templates.mts
 *   MODE=before SHOTS=… tests/e2e/run.sh …   (screenshots only, against the previous build)
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const BEFORE = process.env.MODE === "before";
const SHOTS = process.env.SHOTS ?? "test-results/improve05-after";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, note?: string) => {
  results.push({ check: name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`);
};
const browser = await chromium.launch();

async function phone(email: string) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
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

const sunday = (await q<{ id: string; starts_at: Date }>("select id, starts_at from events where title = 'E2E Sunday fixture'"))[0];
const tpl = (await q<{ id: string }>("select id from duty_templates where code = 'T01'"))[0].id;
const admin = await phone("admin@test.local");
const A = admin.page;
let dialogs: string[] = [];
A.on("dialog", (d) => { dialogs.push(d.message()); void (d.message().startsWith("Switch template") ? d.dismiss() : d.accept()); });

if (BEFORE) {
  await go(A, `/manage/events/${sunday.id}`); await shot(A, "01-event-default");
  await go(A, "/manage/events/new"); await shot(A, "05-new-event");
  await go(A, `/manage/templates/${tpl}`); await shot(A, "06-template-editor");
  await browser.close(); await db.end(); console.log(`before screenshots written to ${SHOTS}`); process.exit(0);
}

// 1. Default tab: staffing first, no edit forms in the way.
await go(A, `/manage/events/${sunday.id}`);
let t = await main(A);
check("event page leads with a staffing summary", /Staffing: \d+ of \d+ places confirmed/.test(t));
check("tabs: Duties (current), Details, Changes",
  (await A.getByRole("navigation", { name: "Event sections" }).getByRole("link").allTextContents()).join(",") === "Duties,Details,Changes" &&
  (await A.getByRole("link", { name: "Duties", exact: true }).getAttribute("aria-current")) === "page");
check("no details form or postpone/cancel on the Duties tab", !t.includes("Save details") && !t.includes("Postpone event") && !t.includes("Cancel event"));
check("adding duties is tucked away behind 'Add duties'", (await A.locator("details", { hasText: "Add duties" }).getAttribute("open")) === null);
await noOverflow(A, "event duties tab");
await shot(A, "01-event-default");

// 2. Removing a duty says who is affected; re-applying a template warns about duplicates.
const cleaning = A.locator("li", { hasText: "Post-event cleaning" }).first();
await cleaning.getByText("Edit or remove").click();
check("removing a duty shows its impact first", ((await cleaning.textContent()) ?? "").includes("1 person is on this duty and will be taken off"));
await A.locator("details", { hasText: "Add duties" }).locator("summary").first().click();
const t01 = A.locator("details details", { hasText: "T01:" });
await t01.locator("summary").click();
check("template re-apply warns when the event already has that duty", ((await t01.textContent()) ?? "").includes("this event already has a"));

// 3. Details tab: unsaved-changes indicator, then save.
await A.getByRole("link", { name: "Details", exact: true }).click();
await A.getByRole("button", { name: "Save details" }).waitFor();
await A.fill("input[name=opponent]", "Synthetic Rovers");
check("editing shows 'Unsaved changes'", await A.getByText("Unsaved changes").isVisible());
check("kick-off is labelled as information only", (await main(A)).includes("changing kick-off moves nothing"));
await shot(A, "02-event-details-unsaved");
await A.getByRole("button", { name: "Save details" }).click();
await A.getByText("Details saved.").waitFor();
check("save clears it and the change is stored", !(await A.getByText("Unsaved changes").isVisible()) && (await q<{ opponent: string }>("select opponent from events where id = $1", [sunday.id]))[0].opponent === "Synthetic Rovers");

// 4. Changes tab: review → nothing saved yet → confirm → saved state.
await go(A, `/manage/events/${sunday.id}?tab=changes`);
t = await main(A);
check("postpone/cancel say who is affected before you act", /This affects \d+ (person|people) on \d+ dut(y|ies)/.test(t));
await A.fill("input[name=start]", "15:00");
await A.fill("input[name=end]", "17:00");
await A.getByRole("button", { name: "Review the change" }).click();
await A.getByText("Check this before saving").waitFor();
t = await main(A);
const stillSame = (await q<{ starts_at: Date }>("select starts_at from events where id = $1", [sunday.id]))[0].starts_at.getTime() === sunday.starts_at.getTime();
check("review shows now vs new, each duty's new time, and who must reconfirm, without saving", t.includes("Now") && t.includes("New") && t.includes("Post-event cleaning") && /will need to reconfirm/.test(t) && stillSame);
await noOverflow(A, "time-change review");
await shot(A, "03-event-change-review");
await A.getByRole("button", { name: "Confirm new times" }).click();
await A.waitForURL(/saved=\d+/);
await A.getByText("New times saved").waitFor();
const moved = (await q<{ starts_at: Date }>("select starts_at from events where id = $1", [sunday.id]))[0].starts_at.getTime();
check("confirm saves the new time (one hour later)", moved - sunday.starts_at.getTime() === 3600_000);
const reset = await q<{ n: number }>(`select count(*)::int as n from assignments a join event_shifts s on s.id = a.shift_id
  where s.event_id = $1 and a.status = 'invited' and a.source = 'self_signup'`, [sunday.id]);
check("people on its duties now need to reconfirm", reset[0].n >= 1);
await shot(A, "04-event-change-saved");

// 5. New event: labelled times, actual duty times, honest template changes.
await go(A, "/manage/events/new");
t = await main(A);
check("creation labels Event start / Event end / Kick-off (information only)", t.includes("Event start") && t.includes("Event end") && t.includes("It doesn't move any duty times"));
check("each template duty shows its actual clock time", /\d\d:\d\d–\d\d:\d\d \(/.test(t));
const tplSelect = A.locator("select[name=template_id]");
const firstTpl = await tplSelect.inputValue();
await A.locator("input[name^=count_]").first().fill("5");
const other = await tplSelect.locator("option").nth(2).getAttribute("value");
dialogs = [];
await tplSelect.selectOption(other!);
check("switching template after adjusting duties asks first (and cancelling keeps them)", dialogs.some((d) => d.startsWith("Switch template")) && (await tplSelect.inputValue()) === firstTpl);
const venueSel = A.locator("select[name=venue_id]");
const venueSpecific = await q<{ code: string }>("select code from duty_templates where id = $1 and venue_id is not null", [firstTpl]);
if (venueSpecific.length) {
  const otherVenue = await venueSel.locator("option").nth(1).getAttribute("value");
  await venueSel.selectOption(otherVenue!);
  check("changing to another venue explains why the venue-only template no longer applies", (await main(A)).includes("so it no longer applies"));
}
await noOverflow(A, "new event");
await shot(A, "05-new-event");

// 6. Template editor: one duty at a time, readable timing with a live sample, saved as the same offsets.
await go(A, `/manage/templates/${tpl}`);
const first = A.locator("details").first();
check("template duties are collapsed, one at a time, with a plain-English summary", (await first.getAttribute("open")) === null && /From .+ (before|after|when) .+ until /.test((await first.textContent()) ?? ""));
await first.locator("summary").click();
const item = (await q<{ id: string; start_offset_minutes: number }>(
  "select id, start_offset_minutes from duty_template_items where template_id = $1 order by sort_order limit 1", [tpl]))[0];
await first.locator("input[name=start_minutes]").fill("90");
await first.locator("select[name=start_dir]").selectOption("before");
await first.locator("select[name=start_anchor]").selectOption("event_start");
check("live sample updates (15:00 start, 90 min before → 13:30)", ((await first.textContent()) ?? "").includes("13:30–"));
check("'Unsaved changes' shows while editing a template duty", await first.getByText("Unsaved changes").isVisible());
check("organiser guidance is labelled as never shown to volunteers", ((await first.textContent()) ?? "").includes("Never shown to volunteers"));
await shot(A, "06-template-editor");
await first.getByRole("button", { name: "Save this duty" }).click();
await first.getByText("Duty saved").waitFor();
const saved = (await q<{ start_anchor: string; start_offset_minutes: number }>("select start_anchor, start_offset_minutes from duty_template_items where id = $1", [item.id]))[0];
check("saved as the same stored rule (event_start, -90)", saved.start_anchor === "event_start" && saved.start_offset_minutes === -90);
check("editor tells the truth about rescheduled events", (await main(A)).includes("its template duties are re-timed using this template"));

await browser.close();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
