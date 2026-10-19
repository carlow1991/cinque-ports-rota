/**
 * Volunteer Hub · Stage 6 — public application and review inbox (C36–C42, H43).
 *   tests/e2e/run.sh tests/e2e/hub-stage6.mts [--build]
 */
import { APP, FAKE, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 6");
// One advertised role so the form can offer it.
const [{ id: sec }] = await q<{ id: string }>("insert into club_positions (title, public_summary, public_visible, seeking_replacement, interest_tags, skills_desirable) values ('Club Secretary', 'Keeps things running.', true, true, '{secretary}', '{administration}') returning id");
const authBefore = (await q<{ n: number }>("select count(*)::int n from auth.users"))[0].n;

const pub = await newPage();
await pub.goto(`${APP}/volunteer/apply`);
await pub.getByRole("heading", { name: "Offer to volunteer" }).waitFor();
await pub.getByLabel("Full name").waitFor();

// Under-18 diverts without collecting anything (C42)
await pub.getByLabel("Full name").fill("Young Person");
await pub.getByLabel("No", { exact: true }).check();
const kid = (await pub.textContent("main")) ?? "";
check("C42: under-18s are shown the parent/carer route", kid.includes("parent or carer"));
check("…and can't continue the adult form", (await pub.getByRole("button", { name: "Next" }).count()) === 0);
await pub.getByLabel("Yes", { exact: true }).check();

// Step 1 validation: a contact method is needed (C41, client side)
await pub.getByLabel("Full name").fill("Applicant (E2E)");
await pub.getByRole("button", { name: "Next" }).click();
check("C41: a contact method is required", ((await pub.textContent("main")) ?? "").includes("Give an email address or a phone number"));
await pub.getByLabel("Email address").fill("applicant.e2e@example.org");
await pub.getByLabel("Email", { exact: true }).check();
await pub.getByLabel("Are you already connected to the club? (optional)").selectOption("parent_carer");
await pub.getByRole("button", { name: "Next" }).click();

// Step 2
await pub.getByText("I'm not sure — please help me find a role").click();
await pub.getByLabel("Refreshments / café").check();
await pub.getByLabel("Club Secretary").check();
await pub.getByLabel("Administration").check();
await pub.getByLabel("Yes", { exact: true }).check();
await pub.getByRole("button", { name: "Next" }).click();
// Back keeps answers
await pub.getByRole("button", { name: "Back" }).click();
check("Back keeps the answers in memory", await pub.getByLabel("Refreshments / café").isChecked());
await pub.getByRole("button", { name: "Next" }).click();

// Step 3
await pub.getByLabel("2–4 hours a month").check();
await pub.getByLabel("Regular").check();
await pub.getByLabel("Sat Morning").check();
await pub.getByLabel("Either").check();
await pub.getByRole("button", { name: "Send my volunteering interest" }).click();
check("C41: the privacy acknowledgement is required", ((await pub.textContent("main")) ?? "").includes("confirm you've read the privacy notice"));
check("…and nothing was saved yet", (await q("select 1 from volunteer_applications")).length === 0);
await pub.locator("input[name=privacy]").check();
await new Promise((r) => setTimeout(r, 3100)); // a person takes longer than the bot trap anyway
await pub.getByRole("button", { name: "Send my volunteering interest" }).click();
await pub.getByText("Thank you for offering to help.").waitFor({ timeout: 15_000 });
check("C36: the applicant sees the agreed thank-you text", ((await pub.textContent("main")) ?? "").includes("someone from Cinque Ports FC will contact you if there is a suitable opportunity"));
check("public form fits a 375px phone", await noHorizontalScroll(pub));
const apps = await q<{ id: string; unsure_role: boolean; interests: string[]; selected_position_ids: string[]; commitment_bucket: string; availability: unknown[] }>(
  "select id, unsure_role, interests, selected_position_ids, commitment_bucket, availability from volunteer_applications");
check("C36: one application stored with their answers", apps.length === 1 && apps[0].unsure_role && apps[0].interests.includes("refreshments")
  && apps[0].selected_position_ids[0] === sec && apps[0].commitment_bucket === "2to4" && apps[0].availability.length === 1);
check("C37: no sign-in account was created", (await q<{ n: number }>("select count(*)::int n from auth.users"))[0].n === authBefore);
check("C37: no person, invitation or role", (await q("select 1 from people where email_normalized = 'applicant.e2e@example.org'")).length === 0 && (await q("select 1 from position_holders")).length === 0);

// Endpoint protections (C38, C41)
const post = (body: unknown, origin = APP) => fetch(`${APP}/api/public/volunteer-applications`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
const valid = { full_name: "Bot", email: "bot@example.org", phone: "", contact_preference: "email", is_adult: true, interests: [], unsure_role: true, selected_position_ids: [], strengths: [],
  experience_text: "", willing_to_learn: "", commitment_bucket: "varies", commitment_pattern: "unsure", availability: [], availability_varies: true, work_location_preference: "either",
  free_notes: "", privacy_acknowledged: true, communication_opt_in: false, form_started_at: Date.now() - 60_000 };
check("C41: cross-site posts are refused", (await post(valid, "https://evil.example")).status === 403);
const honey = await post({ ...valid, website: "http://spam" });
check("C41: honeypot gets a generic success and nothing is saved", honey.status === 200 && (await q("select 1 from volunteer_applications where email_normalized = 'bot@example.org'")).length === 0);
const fast = await post({ ...valid, email: "fast@example.org", form_started_at: Date.now() });
check("C41: an instant submission is dropped quietly", fast.status === 200 && (await q("select 1 from volunteer_applications where email_normalized = 'fast@example.org'")).length === 0);
const bad = await post({ ...valid, email: "", phone: "" });
check("C41: invalid contact is rejected with a message", bad.status === 400 && ((await bad.json()) as { error: string }).error.includes("email address or a phone"));
const minor = await post({ ...valid, email: "minor@example.org", is_adult: false });
check("C42: the endpoint refuses under-18s too", minor.status === 400 && (await q("select 1 from volunteer_applications where email_normalized = 'minor@example.org'")).length === 0);
check("the endpoint can't be read", (await fetch(`${APP}/api/public/volunteer-applications`)).status === 404);
const anonRead = await fetch(`${FAKE}/rest/v1/volunteer_applications?select=*`, { headers: { apikey: "sb_publishable_test" } });
check("C38: the public API key can't read applications", anonRead.status >= 400, `HTTP ${anonRead.status}`);
const anonCall = await fetch(`${FAKE}/rest/v1/rpc/public_submit_application`, { method: "POST", headers: { apikey: "sb_publishable_test", "content-type": "application/json" }, body: JSON.stringify({ p: valid, p_rate_key: "x".repeat(20) }) });
check("C38: …or call the submission function directly", anonCall.status >= 400, `HTTP ${anonCall.status}`);

// Admin review (C39 flag, C40 suggestions, H43)
const admin = await newPage();
await signIn(admin, "admin@test.local");
await admin.goto(`${APP}/manage/applications`);
await admin.getByText("Applicant (E2E)").waitFor({ timeout: 15_000 });
check("C36: the application is in the admin inbox", ((await admin.textContent("main")) ?? "").includes("Help me find a role"));
await admin.getByRole("link", { name: "Applicant (E2E)" }).click();
await admin.getByRole("heading", { name: "Suggested roles" }).waitFor();
const detail = (await admin.textContent("main")) ?? "";
check("C40: suggestions show their reasons", detail.includes("Chose this role on the form") && detail.includes("Strengths match"));
await admin.locator("select[name=stage]").selectOption("contacted");
await admin.getByLabel("I've contacted them today").check();
await admin.getByRole("button", { name: "Save" }).first().click();
await admin.getByText("Saved.").first().waitFor({ timeout: 15_000 }).catch(() => {});
check("H43: stage and contact recorded", (await q("select 1 from volunteer_applications where stage = 'contacted' and last_contacted_at is not null")).length === 1);
await Promise.all([admin.waitForURL(/\/manage\/people\//, { timeout: 20_000 }), admin.getByRole("button", { name: "Add to directory" }).click()]);
const [person] = await q<{ id: string }>("select id from people where email_normalized = 'applicant.e2e@example.org'");
check("H43: added to the directory on request, still with no login or invitation", Boolean(person) && (await q("select 1 from user_accounts where person_id = $1", [person?.id])).length === 0);

const coord = await newPage();
await signIn(coord, "coord@test.local");
await coord.goto(`${APP}/manage/applications`);
await coord.waitForURL((u) => u.pathname === "/home", { timeout: 15_000 }).catch(() => {});
check("coordinators can't open the applications inbox", new URL(coord.url()).pathname === "/home", coord.url());
await finish();
