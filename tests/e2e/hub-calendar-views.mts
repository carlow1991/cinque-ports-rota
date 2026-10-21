/**
 * Volunteer Hub · calendar views (21 Oct 2026): List / Week / Month, filters kept across views.
 *   tests/e2e/run.sh tests/e2e/hub-calendar-views.mts [--build]
 */
import AxeBuilder from "@axe-core/playwright";
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub calendar views");
const ukDay = (plus: number) => new Date(Date.now() + plus * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const today = ukDay(0), month = today.slice(0, 7);
const nextMonthFirst = (() => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); })();
const [{ id: mw }] = await q<{ id: string }>("select id from venues where code = 'marke_wood'");
const ev = async (title: string, day: string, hh: string, extra: { help?: boolean; status?: string } = {}) =>
  (await q<{ id: string }>(`insert into events (title, category, event_type, venue_id, starts_at, ends_at, status, volunteers_enabled)
     values ($1, 'match', 'fixture', $2, ($3 || ' ' || $4)::timestamp at time zone 'Europe/London', ($3 || ' ' || $4)::timestamp at time zone 'Europe/London' + interval '2 hours', $5, $6) returning id`,
    [title, mw, day, hh, extra.status ?? "published", extra.help ?? false]))[0].id;
await ev("Today Match (demo)", today, "15:00", { help: true });
for (const [i, t] of ["A", "B", "C", "D"].entries()) await ev(`Busy ${t} (demo)`, today, `1${i}:00`);
await ev("Cancelled game (demo)", today, "09:00", { status: "cancelled" });
await ev("Draft only (demo)", today, "08:00", { status: "draft" });
await ev("Later fixture (demo)", nextMonthFirst, "10:00");

const kel = await newPage();
await signIn(kel, "vol@test.local");
await kel.setViewportSize({ width: 1280, height: 900 });
await kel.goto(`${APP}/calendar`);
await kel.getByRole("navigation", { name: "Calendar view" }).waitFor();
check("List is the default view", (await kel.getByRole("link", { name: "List", exact: true }).getAttribute("aria-current")) === "page");

await kel.getByRole("link", { name: "Month", exact: true }).click();
await kel.waitForURL(/view=month/);
const grid = kel.getByRole("table");
await grid.waitFor({ timeout: 15_000 });
const caption = (await grid.locator("caption").textContent()) ?? "";
check("Month view shows this month as a grid", caption.includes(new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" })));
check("today is marked", (await grid.locator('[aria-current="date"]').count()) === 1);
const cellText = (await grid.textContent()) ?? "";
check("events appear in the grid, at most 3 per day then '+N more'", cellText.includes("Busy A (demo)") && /\+\d more/.test(cellText));
check("members never see drafts in the month", !cellText.includes("Draft only"));
const cancelledChip = grid.getByRole("link", { name: /Cancelled game \(demo\).*cancelled/ });
check("cancelled events are marked in words, not only struck through", (await cancelledChip.count()) >= 1);
check("today's events are all listed under the grid (including ones the grid hides)", (await kel.getByRole("link", { name: "Busy D (demo)", exact: true }).count()) === 1 && (await kel.getByRole("link", { name: "Today Match (demo)", exact: true }).count()) === 1);

await kel.getByRole("link", { name: "Next month" }).click();
await kel.waitForURL(new RegExp(`month=${nextMonthFirst.slice(0, 7)}`));
await kel.getByRole("table").getByText("Later fixture (demo)").waitFor({ timeout: 15_000 });
check("Next month moves on and shows that month's events", true);
await kel.getByRole("link", { name: `${new Date(nextMonthFirst + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}: 1 event` }).click();
await kel.waitForURL(/day=/);
check("tapping a day lists its events below", (await kel.getByRole("link", { name: "Later fixture (demo)", exact: true }).count()) === 1);
await kel.getByRole("link", { name: "This month" }).click();
await kel.waitForURL((u) => !u.searchParams.get("month"));

// Filters are kept when switching views
await kel.goto(`${APP}/calendar?view=month&help=1`);
await kel.getByRole("table").waitFor();
const helpOnly = (await kel.getByRole("table").textContent()) ?? "";
check("filters apply to the month view", helpOnly.includes("Today Match (demo)") && !helpOnly.includes("Busy A (demo)"));
await kel.getByRole("link", { name: "Week", exact: true }).click();
await kel.waitForURL(/view=week/);
check("…and are kept when switching to Week", new URL(kel.url()).searchParams.get("help") === "1");
const weekText = (await kel.textContent("main")) ?? "";
check("Week view shows seven days with today marked", (await kel.locator("ol > li").count()) === 7 && (await kel.locator('li[aria-current="date"]').count()) === 1 && weekText.includes("Today Match (demo)"));
await kel.getByRole("link", { name: "Next week" }).click();
await kel.waitForURL(/week=/);
check("Next week moves on a week", (await kel.locator('li[aria-current="date"]').count()) === 0);

// Accessibility and small screens
const bad: string[] = [];
for (const v of ["month", "week"]) {
  await kel.goto(`${APP}/calendar?view=${v}`);
  await kel.getByRole("heading", { level: 1 }).waitFor();
  const r = await new AxeBuilder({ page: kel }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  bad.push(...r.violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => `${v}: ${x.id} ${x.nodes.slice(0, 3).map((n) => n.html.slice(0, 160) + " " + (n.any[0]?.message ?? "")).join(" || ")}`));
}
check("Month and Week views: no serious accessibility problems", bad.length === 0, bad.join(", "));
await kel.setViewportSize({ width: 320, height: 640 });
const narrow: string[] = [];
for (const v of ["month", "week", "list"]) {
  await kel.goto(`${APP}/calendar?view=${v}`);
  await kel.getByRole("heading", { level: 1 }).waitFor();
  if (!(await noHorizontalScroll(kel))) narrow.push(v);
}
check("all three views fit a 320px phone", narrow.length === 0, narrow.join(", "));
await finish();
