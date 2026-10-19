/**
 * Improvement increment 4 (volunteer home and clarity) at phone width, synthetic data only.
 *
 *   tests/e2e/run.sh tests/e2e/improve-volunteer-home.mts
 *   MODE=before SHOTS=… tests/e2e/run.sh …   (screenshots only, against the previous build)
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import pg from "pg";

const APP = process.env.APP_URL ?? "http://localhost:3200";
const BEFORE = process.env.MODE === "before";
const SHOTS = process.env.SHOTS ?? "test-results/improve04-after";
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
const newCtx = () => browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London" });

async function signIn(page: Page, email: string) {
  await page.getByRole("button", { name: "Email me a sign-in code" }).waitFor();
  await page.fill("#email", email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await page.fill("#code", "000000");
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.getByRole("button", { name: "Sign in" }).click()]);
}
async function phone(email: string) {
  const ctx = await newCtx();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await page.goto(`${APP}/login`);
  await signIn(page, email);
  return { ctx, page };
}
const main = async (page: Page) => ((await page.textContent("main")) ?? "").replace(/\s+/g, " ");
const shot = (page: Page, n: string) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
async function noOverflow(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${label}: no horizontal scroll at 375px`, over <= 0, over > 0 ? `${over}px too wide` : undefined);
}
async function home(page: Page) {
  await page.goto(`${APP}/rota`);
  await page.getByRole("heading", { level: 1, name: "Rota" }).waitFor();
  await page.waitForLoadState("networkidle");
}

// ---- Synthetic data: a brand-new volunteer with no duties -----------------------------------------
await q(`do $$ declare u uuid; begin
  insert into auth.users (email, email_confirmed_at) values ('nina.new@test.local', now()) returning id into u;
  insert into volunteers (email, display_name, role, invited_at, auth_user_id, linked_at)
  values ('nina.new@test.local', 'Nina New', 'volunteer', now(), u, now());
end $$;`);
const sunday = (await q<{ id: string }>("select id from events where title = 'E2E Sunday fixture'"))[0].id;

// 1. A volunteer with commitments: next duty first, then what's waiting.
const vol = await phone("vol@test.local");
const V = vol.page;
await home(V);
let t = await main(V);
await shot(V, "01-home-with-duties");
if (BEFORE) {
  const nina = await phone("nina.new@test.local");
  await home(nina.page); await shot(nina.page, "02-home-new-volunteer");
  await nina.page.goto(`${APP}/rota/${sunday}`); await nina.page.waitForLoadState("networkidle"); await shot(nina.page, "03-duty-detail");
  await browser.close(); await db.end();
  console.log(`before screenshots written to ${SHOTS}`); process.exit(0);
}
check("home leads with 'Your next duty': the soonest confirmed one, with arrive/finish and status",
  t.indexOf("Your next duty") >= 0 && t.indexOf("Your next duty") < t.indexOf("All events") && t.includes("E2E Soon event") && /Arrive \d\d:\d\d · Finish \d\d:\d\d/.test(t) && t.includes("Confirmed"));
check("outstanding invitations are shown next", t.includes("Waiting for you") && t.includes("2 invitations to answer"));
await noOverflow(V, "volunteer home");

// 2. A brand-new volunteer gets a constructive start and duty-level opportunities.
const nina = await phone("nina.new@test.local");
const N = nina.page;
check("a new volunteer lands on the rota home", new URL(N.url()).pathname === "/rota");
await home(N);
t = await main(N);
await shot(N, "02-home-new-volunteer");
check("no commitments → a constructive invitation to help", t.includes("You're not down for any duties yet") && t.includes("Duties you can take"));
const opps = N.getByRole("heading", { name: "Duties you can take" }).locator("xpath=..").getByRole("listitem");
const oppText = (await opps.allTextContents()).join(" | ");
check("opportunity cards show task, date, time, duration, event, venue and places", /Pitch and equipment setup/.test(oppText) && /\d hr|\d+ min/.test(oppText) && /places? left/.test(oppText) && oppText.includes("Marke Wood"));
check("restricted duties don't dominate: site lead (needs authorisation) is not offered", !oppText.includes("Site lead"));
await noOverflow(N, "new volunteer home");

// 3. Card → duty detail with labelled times → "Take this duty" → persisted Confirmed.
await N.getByRole("link", { name: /^Pitch and equipment setup, .*E2E Sunday fixture/ }).click();
await N.waitForURL(/\/rota\/[0-9a-f-]+#shift-/);
await N.getByRole("heading", { level: 1, name: "E2E Sunday fixture" }).waitFor();
t = await main(N);
check("duty detail labels the event window and each duty's arrive/finish", t.includes("Event ") && t.includes("Each duty below has its own arrive and finish times") && /Arrive 13:00 · Finish 14:00 \(1 hr\)/.test(t));
const take = N.getByRole("button", { name: /^Take this duty: Pitch and equipment setup, .+, 13:00 to 14:00$/ });
check("button says 'Take this duty' and names the duty, day and time for screen readers", (await take.count()) === 1);
await shot(N, "03-duty-detail");
await take.dblclick();               // a double tap must not create two sign-ups
await N.getByText("You're confirmed").first().waitFor();
const rows = await q<{ n: number; status: string }>(`select count(*)::int as n, max(a.status::text) as status from assignments a
  join volunteers v on v.id = a.volunteer_id join event_shifts s on s.id = a.shift_id join duty_types d on d.id = s.duty_type_id
  where v.email = 'nina.new@test.local' and s.event_id = $1 and d.code = 'pitch_setup'`, [sunday]);
check("double tap → exactly one confirmed sign-up", rows[0].n === 1 && rows[0].status === "confirmed");
await N.reload(); await N.waitForLoadState("networkidle");
check("after reload the duty still shows confirmed (result persisted, not just a message)", (await main(N)).includes("You're confirmed"));
await home(N);
t = await main(N);
check("home now shows it as the next duty", t.includes("Your next duty") && t.includes("Pitch and equipment setup") && !t.includes("You're not down for any duties yet"));
await shot(N, "04-home-after-taking");

// 4. Deep link: signed out → sign in → back to the duty; unsafe 'next' is ignored.
const anon = await (await newCtx()).newPage();
await anon.goto(`${APP}/rota/${sunday}`);
await anon.waitForURL(/\/login\?next=/);
await signIn(anon, "vol@test.local");
check("signed-out deep link returns to the event after sign-in", new URL(anon.url()).pathname === `/rota/${sunday}`);
const anon2 = await (await newCtx()).newPage();
await anon2.goto(`${APP}/login?next=${encodeURIComponent("//evil.example/x")}`);
await signIn(anon2, "vol@test.local");
check("an unsafe return address is ignored (lands on home)", new URL(anon2.url()).origin === new URL(APP).origin && new URL(anon2.url()).pathname === "/rota");
const anon3 = await (await newCtx()).newPage();
await anon3.goto(`${APP}/login?next=/manage`);
await signIn(anon3, "vol@test.local");
check("a volunteer is never returned into the organiser area", new URL(anon3.url()).pathname === "/rota");

// 5. No administrator guidance in volunteer copy.
await N.goto(`${APP}/rota/${sunday}`); await N.waitForLoadState("networkidle");
t = (await main(N)).toLowerCase();
check("volunteer pages carry no organiser set-up guidance", !t.includes("split") && !t.includes("when to enable") && !t.includes("ideally included"));

await browser.close();
await db.end();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
