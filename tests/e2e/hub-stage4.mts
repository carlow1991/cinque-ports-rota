/**
 * Volunteer Hub · Stage 4 — shared venue cover and the weekly overview (C26–C30, C47).
 *   tests/e2e/run.sh tests/e2e/hub-stage4.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 4");

const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
const at = async (hhmm: string) => (await q<{ t: Date }>("select (($1 || ' ' || $2)::timestamp at time zone 'Europe/London') t", [day, hhmm]))[0].t;
const [{ id: marke }] = await q<{ id: string }>("select id from venues where code = 'marke_wood'");
const [{ id: park }] = await q<{ id: string }>("insert into venues (code, name, short_name) values ('e2e_park', 'E2E Park', 'Park') returning id");
const mk = async (title: string, s: string, e: string | null, venue = marke) => (await q<{ id: string }>(
  "insert into events (title, category, event_type, venue_id, starts_at, ends_at, kickoff_at, status) values ($1, 'match', 'fixture', $2, $3, $4, $5, 'published') returning id",
  [title, venue, await at(s), e ? await at(e) : null, e ? null : await at(s)]))[0].id;
const mini = await mk("Mini Kickers (E2E)", "09:00", "11:00");
const youth = await mk("Youth Fixtures (E2E)", "09:00", "12:00");
const vets = await mk("Veterans (E2E)", "10:30", null);
await mk("Park game (E2E)", "10:00", "12:00", park);
await q("update people set full_name = 'Kelly (demo)', display_name = null where email_normalized = 'vol@test.local'");
const [{ id: kelly }] = await q<{ id: string }>("select id from people where email_normalized = 'vol@test.local'");

const admin = await newPage();
await signIn(admin, "admin@test.local");

// Arrange Kelly's café cover ONCE, as a request she accepts.
await admin.goto(`${APP}/manage/venue-cover?date=${day}&from=09:00&until=13:00&venue=${marke}&person=${kelly}`);
await admin.getByText("It will appear alongside these events").waitFor({ timeout: 15_000 });
const preview = (await admin.textContent("main")) ?? "";
check("preview lists the three overlapping events (derived, nothing linked)", ["Mini Kickers (E2E)", "Youth Fixtures (E2E)", "Veterans (E2E)"].every((t) => preview.includes(t)));
check("…and says the kick-off-only fixture is covered at kick-off only", preview.includes("at kick-off only"));
const form = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Save cover" }) });
await form.locator("select[name=person_id]").selectOption(kelly);
await form.locator("input[name=label]").fill("Café");
await form.getByRole("button", { name: "Save cover" }).click();
await admin.getByText(/Request saved/).waitFor({ timeout: 15_000 }).catch(() => {});
const covers = await q<{ id: string; state: string }>("select id, state from hub_assignments where scope = 'venue' and person_id = $1", [kelly]);
check("C26: exactly one assignment stored, pending until she accepts", covers.length === 1 && covers[0].state === "pending");

const kel = await newPage();
await signIn(kel, "vol@test.local");
await kel.getByText("You've been asked to help").waitFor({ timeout: 15_000 });
await kel.getByRole("button", { name: /^Accept/ }).first().click();
await kel.getByText("Confirmed — thank you!").waitFor({ timeout: 15_000 }).catch(() => {});
check("Kelly accepted from Home", (await q<{ state: string }>("select state from hub_assignments where id = $1", [covers[0].id]))[0].state === "confirmed");

async function eventText(id: string) {
  await admin.goto(`${APP}/calendar/${id}`);
  await admin.getByRole("heading", { level: 1 }).first().waitFor();
  await admin.getByText(/Venue-wide cover|No one is involved yet/).first().waitFor({ timeout: 10_000 }).catch(() => {});
  return (await admin.textContent("main")) ?? "";
}
const tMini = await eventText(mini), tYouth = await eventText(youth), tVets = await eventText(vets);
check("C26: Mini Kickers, Youth and Veterans all show Kelly's café cover", [tMini, tYouth, tVets].every((t) => t.includes("Venue-wide cover") && t.includes("Kelly (demo)")));
check("C31: the kick-off-only fixture shows cover at kick-off, not the whole event", tVets.includes("Venue cover at kick-off") && !tVets.includes("Venue cover — whole event"));
check("C27: no event assignment clone was created", (await q("select 1 from hub_assignments where scope = 'event' and person_id = $1", [kelly])).length === 0);

await admin.goto(`${APP}/manage`);
await admin.getByRole("heading", { name: "This week" }).waitFor();
await admin.getByText("Mini Kickers (E2E)").first().waitFor({ timeout: 15_000 });
const ov = (await admin.textContent("main")) ?? "";
check("C27/C47: the overview counts Kelly once for the day", ov.includes("1 person confirmed to help (each counted once)"));
check("…and shows her cover once in the venue band", (ov.match(/Kelly \(demo\) — Café/g) ?? []).length === 1);
check("…with 'also supports 3 overlapping events'", ov.includes("Also supports 3 overlapping events"));
check("overview fits a 375px phone", await noHorizontalScroll(admin));
await kel.goto(`${APP}/calendar`);
await kel.getByText("Mini Kickers (E2E)").first().waitFor({ timeout: 15_000 });
const cal = (await kel.textContent("main")) ?? "";
check("calendar shows the shared cover once for that venue and day", (cal.match(/Kelly \(demo\) — Café/g) ?? []).length === 1);

// C28: change end to 11:00 (agreed), then cancel
await admin.goto(`${APP}/manage/venue-cover`);
await admin.getByText("Change times").first().click();
await admin.locator("details[open] input[name=until]").fill("11:00");
await admin.locator("details[open]").getByLabel(/has agreed to the new times/).check();
await admin.locator("details[open]").getByRole("button", { name: "Save change" }).click();
await admin.getByText(/Every overlapping event now shows the new times/).waitFor({ timeout: 15_000 }).catch(() => {});
const tYouth2 = await eventText(youth);
check("C28: Youth (09:00–12:00) now shows partial cover", tYouth2.includes("Venue cover — part of event"));
const tMini2 = await eventText(mini);
check("…while Mini Kickers (09:00–11:00) still shows whole-event cover", tMini2.includes("Venue cover — whole event"));
await admin.goto(`${APP}/manage/venue-cover`);
admin.once("dialog", (d) => d.accept());
await admin.getByRole("button", { name: "Cancel cover" }).first().click();
await admin.getByText("Cancelled.").waitFor({ timeout: 15_000 }).catch(() => {});
const after = [await eventText(mini), await eventText(youth), await eventText(vets)];
check("C28: cancelling removes the cover from all three events at once", after.every((t) => !t.includes("Venue-wide cover")));

// C30: a clash at another venue needs a note
await admin.goto(`${APP}/manage/venue-cover?date=${day}&from=10:00&until=11:00&venue=${park}&person=${kelly}`);
await admin.getByText("It will appear alongside these events").waitFor({ timeout: 15_000 });
await q("insert into hub_assignments (person_id, scope, venue_id, responsibility_label, begins_at, ends_at, state, invitation_source, response_source) values ($1, 'venue', $2, 'Gate', $3, $4, 'confirmed', 'portal', 'self')", [kelly, marke, await at("09:30"), await at("11:30")]);
await admin.reload();
await admin.getByText("It will appear alongside these events").waitFor({ timeout: 15_000 });
check("C30: the preview warns about the clash at Marke Wood", ((await admin.textContent("main")) ?? "").includes("They're already needed elsewhere"));
const form2 = admin.locator("form").filter({ has: admin.getByRole("button", { name: "Save cover" }) });
await form2.locator("select[name=person_id]").selectOption(kelly);
await form2.getByRole("button", { name: "Save cover" }).click();
await admin.getByText(/already needed somewhere else/).waitFor({ timeout: 15_000 }).catch(() => {});
check("…and saving without a note is refused", (await q("select 1 from hub_assignments where venue_id = $1", [park])).length === 0);
await finish();
