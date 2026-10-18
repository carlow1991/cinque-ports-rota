/**
 * Volunteer Hub · Stage 2 — calendar and minimal Create Event (C08–C12, H13, C14 history, C45).
 *   tests/e2e/run.sh tests/e2e/hub-stage2.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 2");
const outboxBefore = (await q<{ n: number }>("select count(*)::int n from notification_outbox"))[0].n;

// Next Saturday (UK) at least 3 days away, as YYYY-MM-DD.
const d = new Date(); d.setUTCDate(d.getUTCDate() + 3);
while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
const SAT = d.toISOString().slice(0, 10);
const sun = new Date(d); sun.setUTCDate(sun.getUTCDate() + 1);
const SUN = sun.toISOString().slice(0, 10);

const admin = await newPage();
await signIn(admin, "admin@test.local");

async function createEvent(f: { title: string; date: string; start: string; end?: string; where?: string; outside?: string; kickoff?: string; help?: boolean }) {
  await admin.goto(`${APP}/manage/events/new`);
  await admin.getByRole("heading", { name: "New event" }).waitFor();
  await admin.getByLabel("Event name (required)").fill(f.title);
  await admin.getByLabel("Date (required)").fill(f.date);
  await admin.getByLabel("Start time (required)").fill(f.start);
  if (f.end) await admin.getByLabel("Finish time").fill(f.end);
  if (f.outside) {
    await admin.locator("select[name=where]").selectOption("outside");
    await admin.getByLabel("Outside or away location").fill(f.outside);
  } else if (f.where) await admin.locator("select[name=where]").selectOption({ label: f.where });
  if (f.help) await admin.getByLabel("Ask volunteers for availability?").check();
  if (f.kickoff) { await admin.getByText("More options").click(); await admin.getByLabel("Kick-off (if different from the start)").fill(f.kickoff); }
  await Promise.all([admin.waitForURL(/\/manage\/events\/[0-9a-f-]{36}\?created=1/, { timeout: 20_000 }), admin.getByRole("button", { name: "Create event" }).click()]);
  return admin.url().match(/events\/([0-9a-f-]{36})/)![1];
}

// C45: only essential fields before the expander, no template wizard or staffing numbers
await admin.goto(`${APP}/manage/events/new`);
await admin.getByRole("heading", { name: "New event" }).waitFor();
const visible = await admin.locator("form input:visible, form select:visible").count();
const pageText = (await admin.textContent("main")) ?? "";
check("C45: Create Event shows the essential fields only", visible <= 8, `${visible} visible fields`);
check("…with no template picker or staffing numbers", !/template|how many|volunteers needed|headcount/i.test(pageText));
const whereOptions = await admin.locator("select[name=where] option").allTextContents();
check("C11: Freemens Way is not offered for a new event", !whereOptions.some((o) => o.includes("Freemens")), whereOptions.join(" | "));

// C08 / C09 / C12 / C10
const mini = await createEvent({ title: "Mini Kickers (E2E)", date: SAT, start: "09:00", end: "11:00", where: "Marke Wood" });
check("C08: creation page says nothing was sent", await admin.getByText("Nothing has been sent.").waitFor({ timeout: 15_000 }).then(() => true, () => false));
await createEvent({ title: "Youth Home Fixtures (E2E)", date: SAT, start: "09:00", end: "12:00", where: "Marke Wood", help: true });
const vets = await createEvent({ title: "Veterans v Test (E2E)", date: SAT, start: "10:30", where: "Marke Wood", kickoff: "10:30" });
await createEvent({ title: "Ladies away (E2E)", date: SUN, start: "14:00", outside: "Charles Sports Ground, Deal" });
check("C10: no venue was created for the away fixture", (await q("select 1 from venues where name ilike '%Deal%'")).length === 0);
check("no emails queued by creating or publishing events", (await q<{ n: number }>("select count(*)::int n from notification_outbox"))[0].n === outboxBefore);

const member = await newPage();
await signIn(member, "vol@test.local");
await member.goto(`${APP}/calendar`);
await member.getByText("Mini Kickers (E2E)").waitFor({ timeout: 15_000 });
const cards = await member.locator("article").filter({ hasText: "(E2E)" }).allTextContents();
check("C09: the three Saturday events appear as separate cards", ["Mini Kickers", "Youth Home Fixtures", "Veterans v Test"].every((t) => cards.some((c) => c.includes(t))), `${cards.length} cards`);
const vetsCard = cards.find((c) => c.includes("Veterans v Test")) ?? "";
check("C12: the kick-off-only fixture shows the finish as not recorded", vetsCard.includes("Kick-off 10:30 — finish not recorded"), vetsCard.slice(0, 80));
const miniCard = cards.find((c) => c.includes("Mini Kickers")) ?? "";
check("C08: information-only event has no help call", miniCard.includes("For information") && !miniCard.includes("Help wanted"));
check("…while the event asking for help is marked", (cards.find((c) => c.includes("Youth Home")) ?? "").includes("Help wanted"));
const calText = (await member.textContent("main")) ?? "";
check("C10: the away fixture is on the calendar under its outside location", cards.some((c) => c.includes("Ladies away")) && calText.includes("Charles Sports Ground, Deal"));
check("calendar fits a 375px phone", await noHorizontalScroll(member));
await member.goto(`${APP}/calendar/${vets}`);
await member.getByRole("heading", { name: "Veterans v Test (E2E)" }).waitFor();
check("event page states the unknown finish", ((await member.textContent("main")) ?? "").includes("finish not recorded"));

// Drafts stay hidden; copies are independent drafts (H13)
await admin.goto(`${APP}/manage/events/${mini}`);
await admin.getByLabel("New date").fill(SUN);
await Promise.all([admin.waitForURL(/created=copy/, { timeout: 20_000 }), admin.getByRole("button", { name: "Copy as draft" }).click()]);
const copyId = admin.url().match(/events\/([0-9a-f-]{36})/)![1];
const [copy] = await q<{ status: string; title: string }>("select status, title from events where id = $1", [copyId]);
check("H13: copy is a new draft with the same details", copy?.status === "draft" && copy.title === "Mini Kickers (E2E)" && copyId !== mini);
await member.goto(`${APP}/calendar/${copyId}`);
check("…and members can't see the draft", (await member.getByText("could not be found", { exact: false }).count()) > 0 || (await member.getByRole("heading", { name: "Mini Kickers (E2E)" }).count()) === 0);

// Cancel keeps history
await admin.goto(`${APP}/manage/events/${vets}`);
await admin.getByText("Cancel this event").click();
await admin.getByLabel("Reason (shown on the event)").fill("Opponents withdrew");
admin.once("dialog", (dlg) => dlg.accept());
await admin.getByRole("button", { name: "Cancel event" }).click();
await admin.getByText("Cancelled. It stays on the calendar").waitFor({ timeout: 15_000 }).catch(() => {});
await member.goto(`${APP}/calendar/${vets}`);
await member.getByRole("heading", { name: "Veterans v Test (E2E)" }).waitFor();
check("C14: a cancelled event stays visible with its reason", ((await member.textContent("main")) ?? "").includes("Opponents withdrew"));

// C11: an existing Freemens Way event remains viewable
const [fw] = await q<{ id: string }>("select e.id from events e join venues v on v.id = e.venue_id where v.code = 'freemens_way' and e.status <> 'draft' limit 1");
if (fw) {
  await member.goto(`${APP}/calendar/${fw.id}`);
  await member.getByRole("heading", { level: 1 }).first().waitFor();
  check("C11: a Freemens Way event is still viewable", ((await member.textContent("main")) ?? "").includes("Freemens Way"));
}
await finish();
