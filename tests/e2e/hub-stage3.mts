/**
 * Volunteer Hub · Stage 3 — availability, requests, invitations, expected by role
 * (C16, C18–C23, C46, information-only never asks).   tests/e2e/run.sh tests/e2e/hub-stage3.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 3");

// Demo cast on the e2e test accounts (names are labels only).
await q("update people set full_name = 'Kelly (demo)', display_name = null, routine_requests_enabled = true where email_normalized = 'vol@test.local'");
await q("update people set full_name = 'Bob (demo)', display_name = null, routine_requests_enabled = true where email_normalized = 'other@test.local'");
await q("update people set full_name = 'Steve (demo)', display_name = null, routine_requests_enabled = true where email_normalized = 'filler@test.local'");
const [{ id: scott }] = await q<{ id: string }>("insert into people (full_name, involvement) values ('Scott (demo manager)', '{manager}') returning id");
const [{ id: pat }] = await q<{ id: string }>("insert into people (full_name, phone_normalized) values ('Pat no-login (demo)', '+447700900333') returning id");
const [{ id: ladiesTeam }] = await q<{ id: string }>("insert into teams (name) values ('Ladies (E2E)') returning id");
await q("insert into team_people (team_id, person_id, role_label, is_expected_by_default, active_from) values ($1, $2, 'Manager', true, '2026-01-01')", [ladiesTeam, scott]);
const [{ id: marke }] = await q<{ id: string }>("select id from venues where code = 'marke_wood'");
const start = new Date(Date.now() + 5 * 86_400_000); start.setUTCHours(13, 0, 0, 0);
const end = new Date(start.getTime() + 3 * 3600_000);
const [{ id: ladies }] = await q<{ id: string }>(
  "insert into events (title, category, event_type, team_id, venue_id, starts_at, ends_at, status, volunteers_enabled) values ('Ladies v Test (E2E)', 'match', 'fixture', $1, $2, $3, $4, 'published', true) returning id",
  [ladiesTeam, marke, start, end]);
const [{ id: info }] = await q<{ id: string }>(
  "insert into events (title, category, event_type, external_location_text, starts_at, status) values ('Away meeting (E2E)', 'meeting', 'meeting', 'Clubhouse at Deal', $1, 'published') returning id", [start]);
const [{ id: kelly }] = await q<{ id: string }>("select id from people where email_normalized = 'vol@test.local'");
const [{ id: bob }] = await q<{ id: string }>("select id from people where email_normalized = 'other@test.local'");
const outboxBefore = (await q<{ n: number }>("select count(*)::int n from notification_outbox"))[0].n;

// --- Organiser requests availability (reviews recipients, presses Send)
const admin = await newPage();
await signIn(admin, "admin@test.local");
await admin.goto(`${APP}/calendar/${ladies}`);
await admin.getByText("Request availability").first().click();
const boxes = admin.locator("#request input[name=person_ids]");
await boxes.first().waitFor();
const ticked = await admin.locator("#request input[name=person_ids]:checked").count();
check("routine volunteers are pre-ticked, managers are not", ticked >= 3 && !(await admin.locator("#request").textContent())!.includes("Scott (demo manager)") === false, `${ticked} ticked`);
const scottBox = admin.locator("#request label").filter({ hasText: "Scott (demo manager)" }).locator("input");
check("C19: the manager is listed but NOT ticked", (await scottBox.count()) === 1 && !(await scottBox.isChecked()));
admin.once("dialog", (d) => d.accept());
await admin.getByRole("button", { name: "Send requests" }).click();
await admin.getByText(/^Asked \d+ people/).waitFor({ timeout: 15_000 }).catch(() => {});
const asked = await q<{ person_id: string }>("select person_id from availability_requests where event_id = $1", [ladies]);
check("requests recorded for the ticked people only", asked.length === ticked && !asked.some((a) => a.person_id === scott), `${asked.length}`);

// --- Member replies from Home in a few taps (C16 / C46)
const kel = await newPage();
await signIn(kel, "vol@test.local");
await kel.getByText("Ladies v Test (E2E)").first().waitFor({ timeout: 15_000 });
check("Home shows the request under 'Can you help?'", (await kel.getByRole("heading", { name: "Can you help?" }).count()) > 0);
let taps = 0;
await kel.getByRole("link", { name: "Reply" }).first().click(); taps++;
await kel.getByRole("button", { name: "Yes" }).click(); taps++;
await kel.getByRole("button", { name: "Send my answer" }).click(); taps++;
await kel.getByText("Thanks — saved.").waitFor({ timeout: 15_000 }).catch(() => {});
const [reply] = await q<{ response: string; for_full_event: boolean; response_source: string }>("select response, for_full_event, response_source from event_availability where event_id = $1 and person_id = $2", [ladies, kelly]);
check(`C16: Yes → whole event saved in ${taps} taps`, reply?.response === "yes" && reply.for_full_event && reply.response_source === "self" && taps < 4);
check("…and saying yes did not create an assignment", (await q("select 1 from hub_assignments where person_id = $1", [kelly])).length === 0);
check("event page fits a 375px phone", await noHorizontalScroll(kel));

// --- Direct invitation: Bob accepts (C20), Steve declines (C21)
await admin.goto(`${APP}/calendar/${ladies}`);
async function invite(name: string) {
  await admin.locator("#invite summary").click();
  await admin.locator("#invite select[name=person_id]").selectOption({ label: name });
  await admin.locator("#invite input[name=label]").fill("Matchday support");
  await admin.locator("#invite").getByRole("button", { name: "Save" }).click();
  await admin.getByText(/Request saved|already have this request/).first().waitFor({ timeout: 15_000 }).catch(() => {});
  await admin.reload();
}
await invite("Bob (demo)");
await invite("Steve (demo)");
const [bobA] = await q<{ state: string }>("select state from hub_assignments where event_id = $1 and person_id = $2", [ladies, bob]);
check("C20: Bob is pending after the invitation (not confirmed)", bobA?.state === "pending", bobA?.state);
const bobPage = await newPage();
await signIn(bobPage, "other@test.local");
await bobPage.getByText("You've been asked to help").waitFor({ timeout: 15_000 });
await bobPage.getByRole("button", { name: /^Accept/ }).first().click();
await bobPage.getByText("Confirmed — thank you!").waitFor({ timeout: 15_000 }).catch(() => {});
const [bobB] = await q<{ state: string; response_source: string }>("select state, response_source from hub_assignments where event_id = $1 and person_id = $2", [ladies, bob]);
check("C20: Bob is confirmed only once he accepts", bobB?.state === "confirmed" && bobB.response_source === "self");
const steve = await newPage();
await signIn(steve, "filler@test.local");
await steve.getByText("You've been asked to help").waitFor({ timeout: 15_000 });
await steve.getByRole("button", { name: /^Decline/ }).first().click();
await steve.getByText("Declined.").waitFor({ timeout: 15_000 }).catch(() => {});
const states = await q<{ state: string }>("select state from hub_assignments where event_id = $1 order by state", [ladies]);
check("C21: Steve declined; Bob still confirmed", states.map((s) => s.state).join(",") === "confirmed,declined");

// --- Offline recording (C22) and expected by role (C23)
await admin.goto(`${APP}/calendar/${ladies}`);
await admin.locator("#record summary").click();
await admin.locator("#record select[name=person_id]").selectOption({ label: "Pat no-login (demo) (no Hub login)" });
await admin.locator("#record").getByRole("button", { name: "Record" }).click();
await admin.getByText(/Recorded\. It shows/).waitFor({ timeout: 15_000 }).catch(() => {});
const [patR] = await q<{ response_source: string }>("select response_source from event_availability where event_id = $1 and person_id = $2", [ladies, pat]);
check("C22: offline reply stored as recorded by organiser", patR?.response_source === "admin_recorded");
await admin.reload();
await admin.getByRole("heading", { name: /Confirmed to help/ }).waitFor({ timeout: 15_000 }).catch(() => {});
const main = (await admin.textContent("main")) ?? "";
check("…and labelled 'Recorded by' on the event page", /Recorded by/.test(main));
check("C23: Scott appears under Expected by role, as not confirmed", main.includes("Expected by role") && main.includes("Manager — expected, not confirmed"));
check("Bob under Confirmed to help", main.includes("Confirmed to help") && main.includes("Bob (demo)"));
await kel.goto(`${APP}/calendar/${ladies}`);
await kel.getByRole("heading", { name: "Ladies v Test (E2E)" }).waitFor();
const memberView = (await kel.textContent("main")) ?? "";
check("members don't see who hasn't replied or declined", !memberView.includes("Awaiting response") && !memberView.includes("Declined or can't help"));
check("members don't see contact numbers", !memberView.includes("07700 900333"));

// --- Information-only event never asks
await kel.goto(`${APP}/calendar/${info}`);
await kel.getByRole("heading", { name: "Away meeting (E2E)" }).waitFor();
check("information-only event shows no 'Can you help?'", (await kel.getByRole("heading", { name: "Can you help?" }).count()) === 0);
// Since Stage 7, deliberate actions (requests, invitations, answers) queue email; nothing else does.
const DELIBERATE = ["availability_request", "assignment_request", "assignment_confirmed", "assignment_declined", "assignment_withdrawn"];
const other = await q<{ kind: string }>("select kind from notification_outbox where not (kind = any($1))", [DELIBERATE]);
check("C50: only requests, invitations and answers queued email", other.length === 0, other.map((r) => r.kind).join(", "));
await finish();
