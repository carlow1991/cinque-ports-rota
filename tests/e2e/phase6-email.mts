/**
 * Phase 6 checks: email outbox end to end against the production build, with a FAKE email
 * provider (inside the fake Supabase server). Nothing here can send a real email.
 *  - a change sends its email straight away, once, with only the recipient's own duty
 *  - provider idempotency: a re-sent message after a crash is not delivered twice
 *  - retry with backoff after a provider error; permanent failure; admin "retry failed"
 *  - staging allow-list and demo suppression; day-before reminders on the UK date
 *  - cron endpoint authentication, security headers, no secrets in the browser bundle
 *
 *   tests/e2e/run.sh tests/e2e/phase6-email.mts --build
 */
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const FAKE = process.env.FAKE_URL ?? "http://127.0.0.1:54399";
const CRON = process.env.CRON_SECRET ?? "";
const SHOTS = process.env.SHOTS ?? "test-results/phase6";
mkdirSync(SHOTS, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DB_URL });
await db.connect();
const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string) => { results.push({ check: name, ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? ` (${note})` : ""}`); };

type Mail = { id: string; key: string; to: string[]; subject: string; html: string; text: string };
const mail = async () => (await (await fetch(`${FAKE}/mail/_sent`)).json()) as { sent: Mail[]; repeats: number };
const failNext = (statuses: number[]) => fetch(`${FAKE}/mail/_fail`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statuses }) });
const cron = async (auth: string | null = `Bearer ${CRON}`) => {
  const r = await fetch(`${APP}/api/cron/outbox`, { headers: auth ? { authorization: auth } : {}, redirect: "manual" });
  return { status: r.status, body: await r.text(), headers: r.headers };
};
async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 15_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 250)); }
  return undefined;
}
const row = async (where: string, p: unknown[] = []) => (await q<{ id: string; status: string; attempt_count: number; error: string | null; provider_message_id: string | null; dedupe_key: string; send_after: Date }>(
  `select id, status, attempt_count, error, provider_message_id, dedupe_key, send_after from notification_outbox where ${where} order by created_at desc limit 1`, p))[0];

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
const dutyCard = (page: Page, duty: string) => page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: duty, level: 3 }) });

// ---------------------------------------------------------------------------------------------
// 1. The cron endpoint is locked; security headers are present.
// ---------------------------------------------------------------------------------------------
check("cron: no token → 401 (not a redirect to sign-in)", (await cron(null)).status === 401);
check("cron: wrong token → 401", (await cron("Bearer wrong-secret-wrong-secret")).status === 401);
check("cron: secret without 'Bearer' → 401", (await cron(CRON)).status === 401);
const ok = await cron();
check("cron: correct token → 200 with counts only", ok.status === 200 && !ok.body.includes("@"), ok.body);
check("cron response is not cacheable", ok.headers.get("cache-control") === "no-store");

const h = (await fetch(`${APP}/login`)).headers;
check("header: X-Content-Type-Options nosniff", h.get("x-content-type-options") === "nosniff");
check("header: X-Frame-Options DENY", h.get("x-frame-options") === "DENY");
check("header: CSP frame-ancestors 'none'", (h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"));
check("header: Referrer-Policy strict-origin-when-cross-origin", h.get("referrer-policy") === "strict-origin-when-cross-origin");
check("header: HSTS set", (h.get("strict-transport-security") ?? "").includes("max-age="));
check("header: Permissions-Policy blocks camera/mic/location", /camera=\(\).*microphone=\(\).*geolocation=\(\)/.test(h.get("permissions-policy") ?? ""));
check("header: no X-Powered-By", !h.has("x-powered-by"));

// ---------------------------------------------------------------------------------------------
// 2. A volunteer signs up: the confirmation email goes out at once, once, with only their duty.
// ---------------------------------------------------------------------------------------------
const vol = await phone("vol@test.local");
const V = vol.page;
await V.getByRole("link", { name: /E2E Sunday fixture/ }).click();
await V.waitForURL(/\/rota\/[0-9a-f-]{36}/);
await dutyCard(V, "Pitch and equipment setup").getByRole("button", { name: "Sign up" }).click();
await dutyCard(V, "Pitch and equipment setup").getByText("You're confirmed").waitFor();
const confirm = await waitFor(async () => (await mail()).sent.find((m) => m.subject.startsWith("You're confirmed") && m.to[0] === "vol@test.local"));
check("sign-up confirmation sent straight after the change (no cron needed)", Boolean(confirm));
if (confirm) {
  check("email shows the duty, event and UK time with GMT/BST", confirm.text.includes("Pitch and equipment setup") && confirm.text.includes("E2E Sunday fixture") && /\d\d:\d\d–\d\d:\d\d (GMT|BST)/.test(confirm.text), confirm.text.split("\n").find((l) => l.startsWith("When")));
  const everything = confirm.html + confirm.text;
  check("email contains no other volunteer's name, email or phone (no roster)", !/Other Person|other@test\.local|07700|filler|Filler/.test(everything));
  check("email links into the app", confirm.text.includes(`${APP.replace("localhost", "localhost")}/my-duties`) || confirm.text.includes("/my-duties"));
  check("email used the outbox dedupe key as Idempotency-Key", confirm.key.startsWith("signup_confirmed:"));
}
const sent1 = (await waitFor(() => row("kind = 'signup_confirmed' and status = 'sent'")))!;
check("outbox row marked sent with the provider's message id", Boolean(sent1?.provider_message_id), sent1?.status);

// 3. Crash after sending but before recording: the retry must not deliver a second copy.
const before = (await mail()).sent.length;
await q("update notification_outbox set status = 'pending', sent_at = null where id = $1", [sent1.id]);
await cron();
const after = await mail();
check("re-sent after a simulated crash: provider idempotency stops a duplicate", after.sent.length === before && after.repeats >= 1, `sent ${before}→${after.sent.length}, repeats ${after.repeats}`);
check("…and the row is sent again", (await row("id = $1", [sent1.id])).status === "sent");

// ---------------------------------------------------------------------------------------------
// 4. Provider errors: retried with backoff, then sent once; a permanent error fails.
// ---------------------------------------------------------------------------------------------
await failNext([503]);
await V.goto(`${APP}/my-duties?tab=confirmed`);
await V.getByRole("heading", { level: 1, name: "My Duties" }).waitFor();
V.on("dialog", (d) => d.accept());
await V.locator("li", { hasText: "E2E Withdrawable duty event" }).getByRole("button", { name: "Withdraw from this duty" }).click();
await V.locator("li", { hasText: "E2E Withdrawable duty event" }).waitFor({ state: "detached" });
const retryRow = await waitFor(async () => { const r = await row("kind = 'withdrawal_confirmed'"); return r && r.attempt_count >= 1 && r.status !== "sending" ? r : undefined; });
check("503 from the provider → back in the queue with a later retry time", retryRow?.status === "pending" && (retryRow?.error ?? "").startsWith("http 503"), `${retryRow?.status} ${retryRow?.error}`);
check("retry delay is ~2 minutes", retryRow ? Math.abs(new Date(retryRow.send_after).getTime() - Date.now() - 120_000) < 30_000 : false);
const sentBeforeRetry = (await mail()).sent.filter((m) => m.subject.includes("taken off")).length;
await q("update notification_outbox set send_after = now() where id = $1", [retryRow!.id]);
await cron();
const afterRetry = await row("id = $1", [retryRow!.id]);
check("on the next run it is sent, on attempt 2", afterRetry.status === "sent" && afterRetry.attempt_count === 2);
check("exactly one withdrawal email delivered", sentBeforeRetry === 0 && (await mail()).sent.filter((m) => m.subject.includes("taken off")).length === 1);

// ---------------------------------------------------------------------------------------------
// 5. Staging allow-list, demo events, permanent failure → admin retry.
// ---------------------------------------------------------------------------------------------
const [other] = await q<{ id: string }>("select id from volunteers where email = 'other@test.local'");
const [otherA] = await q<{ id: string }>("select a.id from assignments a where a.volunteer_id = $1 limit 1", [other.id]);
await q("select public._enqueue($1, 'reminder', 'assignments', $2, 'e2e:not-allowlisted', public._assignment_payload($2), false)", [other.id, otherA.id]);
await q("update notification_outbox set kind = 'signup_confirmed' where dedupe_key = 'e2e:not-allowlisted'");
await cron();
const blocked = await row("dedupe_key = 'e2e:not-allowlisted'");
check("staging: address not on the allow-list is suppressed, not sent", blocked.status === "suppressed" && blocked.error === "not_allowlisted");
check("staging: nothing ever delivered to other@test.local", !(await mail()).sent.some((m) => m.to.includes("other@test.local")));

const [vRow] = await q<{ id: string }>("select id from volunteers where email = 'vol@test.local'");
await q("select public._enqueue($1, 'signup_confirmed', 'assignments', $2, 'e2e:demo', public._assignment_payload($2), true)", [vRow.id, otherA.id]);
await cron();
check("demo event email is suppressed and never delivered", (await row("dedupe_key = 'e2e:demo'")).status === "suppressed" && !(await mail()).sent.some((m) => m.key === "e2e:demo"));

// Permanent provider rejection → failed → admin retries from Settings.
const [volA] = await q<{ id: string }>("select a.id from assignments a where a.volunteer_id = $1 and a.status = 'confirmed' limit 1", [vRow.id]);
await q("select public._enqueue($1, 'approval_confirmed', 'assignments', $2, 'e2e:permanent', public._assignment_payload($2), false)", [vRow.id, volA.id]);
await failNext([422]);
// The fake answers 422 as a generic error name; the worker treats 4xx (other than 429) as permanent.
await cron();
const perm = await row("dedupe_key = 'e2e:permanent'");
check("permanent provider error → failed immediately (no pointless retries)", perm.status === "failed" && perm.attempt_count === 1, `${perm.status} ${perm.error}`);
check("stored error has no address in it", !(perm.error ?? "").includes("@"));

const admin = await phone("admin@test.local");
const A = admin.page;
await A.goto(`${APP}/manage/settings`);
await A.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
const cardText = (await A.textContent("main")) ?? "";
check("settings: admin sees email is on in TEST mode with the allow-list size", cardText.includes("test mode") && cardText.includes("3 approved test addresses"));
check("settings: counts shown, no addresses on the page", /Failed\s*1/.test(cardText.replace(/\n/g, " ")) && !/@test\.local/.test(cardText));
await A.screenshot({ path: `${SHOTS}/settings-email.png`, fullPage: true });
await A.getByRole("button", { name: "Retry failed emails" }).click();
await A.getByText(/queued to try again/).waitFor();
const retried = await waitFor(async () => { const r = await row("dedupe_key = 'e2e:permanent'"); return r.status === "sent" ? r : undefined; });
check("admin 'Retry failed emails' re-queues and it sends", Boolean(retried));

const coord = await phone("coord@test.local");
await coord.page.goto(`${APP}/manage/settings`);
await coord.page.waitForLoadState("networkidle");
check("coordinator can't open the email settings", !((await coord.page.textContent("body")) ?? "").includes("Retry failed emails"));
await coord.ctx.close();

// ---------------------------------------------------------------------------------------------
// 6. Day-before reminder, keyed on the UK date; re-running doesn't duplicate.
// ---------------------------------------------------------------------------------------------
await q(`do $$
declare mw uuid := (select id from venues where code = 'marke_wood'); uk text := 'Europe/London';
  d date := (now() at time zone 'Europe/London')::date + 1; e uuid; s uuid;
begin
  insert into events (venue_id, title, event_type, starts_at, ends_at, status, site_responsibility)
  values (mw, 'E2E Tomorrow fixture', 'fixture', (d + time '11:00') at time zone uk, (d + time '13:00') at time zone uk, 'published', false) returning id into e;
  insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count)
  values (e, (select id from duty_types where code = 'refreshments'), (d + time '11:00') at time zone uk, (d + time '13:00') at time zone uk, 1) returning id into s;
  insert into assignments (shift_id, volunteer_id, status, source) values (s, (select id from volunteers where email = 'vol@test.local'), 'confirmed', 'self_signup');
end $$;`);
await cron();
await cron();
const rem = await q<{ id: string; dedupe_key: string; send_after: Date; status: string }>(
  `select o.id, o.dedupe_key, o.send_after, o.status from notification_outbox o join assignments a on a.id = o.entity_id
   join event_shifts s on s.id = a.shift_id join events e on e.id = s.event_id where o.kind = 'reminder' and e.title = 'E2E Tomorrow fixture'`);
const [{ tomorrow, due }] = await q<{ tomorrow: string; due: Date }>(
  "select to_char((now() at time zone 'Europe/London')::date + 1, 'YYYY-MM-DD') as tomorrow, greatest(now(), (((now() at time zone 'Europe/London')::date + time '18:00') at time zone 'Europe/London')) as due");
check("reminder queued once for tomorrow's duty (two cron runs)", rem.length === 1, `${rem.length}`);
check("reminder keyed on the UK date", rem[0]?.dedupe_key.endsWith(`:${tomorrow}`), rem[0]?.dedupe_key);
check("reminder due at 18:00 UK today (or now if later)", rem[0] ? Math.abs(new Date(rem[0].send_after).getTime() - new Date(due).getTime()) < 120_000 : false);
await q("update notification_outbox set send_after = now() where id = $1", [rem[0].id]);
await cron();
const remMail = (await mail()).sent.find((m) => m.subject.startsWith("Tomorrow:") && m.text.includes("E2E Tomorrow fixture"));
check("reminder delivered with the duty details", Boolean(remMail) && remMail!.text.includes("Refreshments"));

// ---------------------------------------------------------------------------------------------
// 7. No secrets in anything sent to the browser.
// ---------------------------------------------------------------------------------------------
const secrets = ["re_test_key", CRON, "sb_secret_test", "EMAIL_PROVIDER_API_KEY", "CRON_SECRET", "SUPABASE_SECRET_KEY", "EMAIL_STAGING_ALLOWLIST"];
const hits: string[] = [];
function scan(dir: string) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) scan(p);
    else { const s = readFileSync(p, "utf8"); for (const k of secrets) if (k && s.includes(k)) hits.push(`${k} in ${p}`); }
  }
}
scan(".next/static");
check("browser bundle contains no email/cron/secret keys or their names", hits.length === 0, hits.slice(0, 3).join("; "));
const pageHtml = await (await A.context().request.get(`${APP}/manage/settings`)).text();
check("rendered settings page contains no keys or allow-listed addresses", !secrets.some((k) => k && pageHtml.includes(k)) && !pageHtml.includes("vol@test.local"));

await admin.ctx.close(); await vol.ctx.close();
await browser.close(); await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
