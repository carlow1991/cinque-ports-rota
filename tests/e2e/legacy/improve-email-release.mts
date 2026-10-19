/**
 * Improvement increment 6 (email rollout gate) end to end, against the fake mail provider.
 *
 *   tests/e2e/run.sh tests/e2e/improve-email-release.mts
 *
 * The hosting switch is ON (staging + allow-list, as in every e2e run). Checks: nothing is sent while
 * held, even by the scheduled job; Settings shows what is held, still true and out of date; "start and
 * include still-true" sends only messages that are still true; pause stops sending again; organiser
 * wording says "paused" while held. Synthetic data only; no real email can be sent.
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:54399";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
const SHOTS = process.env.SHOTS ?? "test-results/improve06-after";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };
type Mail = { to: string[]; subject: string };
const mail = async () => ((await (await fetch(`${FAKE}/mail/_sent`)).json()) as { sent: Mail[] }).sent;
const cron = () => fetch(`${APP}/api/cron/outbox`, { headers: { authorization: `Bearer ${CRON}` } });
async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); }
  return undefined;
}
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
const dutyCard = (page: Page, duty: string) => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: duty, level: 3 }) });
const sunday = (await q<{ id: string }>("select id from events where title = 'E2E Sunday fixture'"))[0].id;

if (process.env.MODE !== "before") {
  check("a fresh club database starts with email held", (await q<{ r: string | null }>("select email_released_from::text as r from club_settings where id = 1"))[0].r === null);
}

// 1. While held: a volunteer signs up for two duties and withdraws from one.
const vol = await phone("vol@test.local");
const V = vol.page;
await V.goto(`${APP}/rota/${sunday}`);
await V.getByRole("heading", { level: 1, name: "E2E Sunday fixture" }).waitFor();
await dutyCard(V, "Pitch and equipment setup").getByRole("button", { name: /^Take this duty/ }).click();
await dutyCard(V, "Pitch and equipment setup").getByText("You're confirmed").waitFor();
await dutyCard(V, "Refreshments / tea bar").getByRole("button", { name: /^Take this duty/ }).click();
await dutyCard(V, "Refreshments / tea bar").getByText("You're confirmed").waitFor();
await V.goto(`${APP}/my-duties?tab=confirmed`);
await V.locator("li", { hasText: "Refreshments / tea bar" }).getByRole("button", { name: "Withdraw from this duty" }).click();
await V.locator("li", { hasText: "Refreshments / tea bar" }).waitFor({ state: "detached" });

const r = await cron();
if (process.env.MODE === "before") {
  const a0 = await phone("admin@test.local");
  await a0.page.goto(`${APP}/manage/settings`); await a0.page.waitForLoadState("networkidle");
  await a0.page.screenshot({ path: `${SHOTS}/01-settings-held.png`, fullPage: true });
  await a0.page.locator("section", { has: a0.page.getByRole("heading", { name: "Email", exact: true }) }).last().screenshot({ path: `${SHOTS}/01-email-card.png` });
  await browser.close(); await db.end(); console.log(`before screenshots written to ${SHOTS}`); process.exit(0);
}
check("the scheduled job runs while held but sends nothing", r.status === 200 && (await mail()).length === 0);
const pending = await q<{ n: number }>("select count(*)::int as n from notification_outbox where status = 'pending'");
check("messages are kept, waiting (not lost)", pending[0].n >= 3);

// 2. Organiser wording while held says "paused", never "on its way".
const admin = await phone("admin@test.local");
const A = admin.page;
const pitch = (await q<{ id: string }>("select s.id from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'general_support'", [sunday]))[0].id;
await A.goto(`${APP}/manage/shifts/${pitch}/assign`);
await A.getByRole("heading", { level: 1, name: "Invite a volunteer" }).waitFor();
check("invite page says email is paused while held", (await main(A)).includes("Email is paused, so nobody is emailed"));

// 3. Settings: what is held, what is still true, what is out of date.
await A.goto(`${APP}/manage/settings`);
await A.getByRole("heading", { name: "Email", exact: true }).waitFor();
let t = await main(A);
check("settings shows both switches: hosting on (test mode), started here: no", /1\. Hosting switch\s*On in test mode/.test(t) && /2\. Started here\s*No: held/.test(t));
check("settings lists held emails by type with 'still true' counts and no addresses", t.includes("Sign-up confirmed") && t.includes("Withdrawal confirmed") && /out of date/.test(t) && !t.includes("@test.local"));
await A.screenshot({ path: `${SHOTS}/01-settings-held.png`, fullPage: true });
await A.locator("#email").screenshot({ path: `${SHOTS}/01-email-card.png` });

// 4. Start and include still-true: only the true ones go.
await A.getByRole("button", { name: /^Start, and also send the \d+ still-true held email/ }).click();
await A.getByText("Email started.").waitFor();
await cron();
const sent = await waitFor(async () => { const m = await mail(); return m.length >= 2 ? m : null; });
const subjects = (sent ?? []).filter((m) => m.to.includes("vol@test.local")).map((m) => m.subject);
check("the still-true confirmation and withdrawal emails are sent", subjects.some((s) => s.includes("Pitch and equipment setup")) && subjects.some((s) => s.includes("taken off")));
check("the out-of-date 'you're confirmed' for the withdrawn duty is never sent", !subjects.some((s) => s.includes("confirmed") && s.includes("Refreshments")));
const why = await q<{ error: string }>(`select o.error from notification_outbox o where o.kind = 'signup_confirmed' and o.payload->>'duty' = 'Refreshments / tea bar' and o.status = 'suppressed'`);
check("…and the reason is recorded", why.length === 1 && ["out_of_date_at_release", "status_changed", "superseded"].includes(why[0].error));
await A.reload();
await A.getByRole("heading", { name: "Email", exact: true }).waitFor();
t = await main(A);
check("once started, settings offers 'Pause all emails' and shows since when", t.includes("Pause all emails") && /Started here\s*Yes, since/.test(t), t.slice(t.indexOf("Hosting switch"), t.indexOf("Hosting switch") + 160));
await A.screenshot({ path: `${SHOTS}/02-settings-started.png`, fullPage: true });

// 5. Pause: nothing more is sent.
await A.getByRole("button", { name: "Pause all emails" }).click();
await A.getByText("Email paused.").waitFor();
const before = (await mail()).length;
await V.goto(`${APP}/rota/${sunday}`);
await dutyCard(V, "Gate / admission collection").getByRole("button", { name: /^Request this duty/ }).click();
await dutyCard(V, "Gate / admission collection").getByText("Awaiting organiser approval").waitFor();
await cron();
await new Promise((res) => setTimeout(res, 1500));
check("after pausing, new messages are held, not sent", (await mail()).length === before);

await browser.close();
await db.end();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
