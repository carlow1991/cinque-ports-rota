/**
 * Volunteer Hub · Stage 1 — people directory, explicit invitations, privacy (C01, C02, C03, H06, H07).
 *   tests/e2e/run.sh tests/e2e/hub-stage1.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 1");
const outbox = async () => (await q<{ n: number }>("select count(*)::int n from notification_outbox"))[0].n;
const outboxBefore = await outbox();

// --- Admin adds Scott with a name only (C01)
const admin = await newPage();
await signIn(admin, "admin@test.local");
check("admin lands on Manage", new URL(admin.url()).pathname === "/manage", admin.url());
await admin.goto(`${APP}/manage/people/new`);
await admin.getByRole("heading", { name: "Add person" }).waitFor();
const fieldsBeforeMore = await admin.locator("form input:visible, form select:visible, form textarea:visible").count();
check("Add Person shows only a few fields before 'More details'", fieldsBeforeMore > 0 && fieldsBeforeMore <= 10, `${fieldsBeforeMore} visible inputs`);
check("…both invitation and suggestion boxes are off by default",
  !(await admin.getByLabel("Send portal invitation now").isChecked()) && !(await admin.getByLabel("Include in suggested availability recipients").isChecked()));
await admin.getByLabel("Name (required)").fill("Scott (demo manager)");
await admin.getByLabel("Manager / coach").check();
await Promise.all([admin.waitForURL(/\/manage\/people\/[0-9a-f-]{36}/), admin.getByRole("button", { name: "Save person" }).click()]);
check("saving Scott says nothing was sent", await admin.getByText("Saved. Nothing was sent.").waitFor({ timeout: 15_000 }).then(() => true, () => false));
check("…and shows him as Not invited", (await admin.getByText("Not invited").count()) > 0);
const [scott] = await q<{ id: string; email: string | null; rr: boolean }>("select id, email_normalized::text email, routine_requests_enabled rr from people where full_name = 'Scott (demo manager)'");
check("Scott persists with no email and routine requests off", Boolean(scott) && scott.email === null && scott.rr === false);
check("…with no portal account", (await q("select 1 from user_accounts where person_id = $1", [scott.id])).length === 0);

// --- Team role, expected by role (H07)
await q("insert into teams (name) values ('Veterans (E2E)') on conflict do nothing");
await admin.reload();
await admin.getByText("Add a team role").click();
await admin.locator("select[name=team_id]").selectOption({ label: "Veterans (E2E)" });
await admin.locator("details[open] input[name=role_label]").fill("Manager");
await admin.getByLabel("Expected at this team's events").last().check();
await admin.getByRole("button", { name: "Add role" }).click();
await admin.getByText("Team role saved.").waitFor({ timeout: 15_000 }).catch(() => {});
const [tp] = await q<{ is_expected_by_default: boolean }>("select is_expected_by_default from team_people where person_id = $1", [scott.id]);
check("Scott recorded as expected at Veterans events", tp?.is_expected_by_default === true);

// --- Kelly with contact + routine requests, then an explicit invite (C02)
await admin.goto(`${APP}/manage/people/new`);
await admin.getByLabel("Name (required)").fill("Kelly (demo)");
await admin.getByLabel("Email (optional)").fill("kelly@test.local");
await admin.getByLabel("Telephone (optional)").fill("07700 900123");
await admin.getByLabel("Include in suggested availability recipients").check();
await Promise.all([admin.waitForURL(/\/manage\/people\/[0-9a-f-]{36}/), admin.getByRole("button", { name: "Save person" }).click()]);
const [kelly] = await q<{ id: string; phone: string; rr: boolean }>("select id, phone_normalized phone, routine_requests_enabled rr from people where email_normalized = 'kelly@test.local'");
check("Kelly saved with normalised phone and routine suggestions on", kelly?.phone === "+447700900123" && kelly.rr);
check("…and nothing queued or sent for her or Scott", (await outbox()) === outboxBefore);
admin.once("dialog", (d) => d.accept());
await admin.getByRole("button", { name: "Send portal invitation" }).click();
await admin.getByText(/Invitation emailed to kelly@test.local/).waitFor({ timeout: 15_000 }).catch(() => {});
const [acc] = await q<{ invite_state: string }>("select invite_state from user_accounts where person_id = $1", [kelly.id]);
check("explicit invite sent once and recorded", acc?.invite_state === "sent", acc?.invite_state);
const audits = await q<{ action: string }>("select action from audit_log where entity_id = $1 and action like 'portal_invite%' order by id", [kelly.id]);
check("…and audited", audits.map((a) => a.action).join(",") === "portal_invite_prepared,portal_invite_sent", audits.map((a) => a.action).join(","));
check("admin pages fit a 375px phone", await noHorizontalScroll(admin));

// --- A member sees the directory without private contact details (C03)
const member = await newPage();
await signIn(member, "vol@test.local");
check("member lands on Home", new URL(member.url()).pathname === "/home", member.url());
await member.goto(`${APP}/people`);
await member.getByText("Kelly (demo)").first().waitFor({ timeout: 15_000 }).catch(() => {});
const text = (await member.textContent("main")) ?? "";
check("member directory lists people", text.includes("Kelly (demo)"));
check("…without unshared phone numbers or emails", !text.includes("07700 900123") && !text.includes("kelly@test.local") && !text.includes("other@test.local"));
await member.goto(`${APP}/manage/people`);
await member.waitForURL((u) => u.pathname === "/home", { timeout: 15_000 }).catch(() => {});
check("member is bounced from the organiser area", new URL(member.url()).pathname === "/home", member.url());
await member.goto(`${APP}/manage/people/${kelly.id}`);
await member.waitForURL((u) => u.pathname === "/home", { timeout: 15_000 }).catch(() => {});
const leaked = ((await member.textContent("body")) ?? "").includes("kelly@test.local");
check("…including direct URLs to another person's record (no data shown)", new URL(member.url()).pathname === "/home" && !leaked, member.url());
await member.goto(`${APP}/my-profile`);
await member.getByLabel("Name shown in the Hub").fill("Val V");
await member.getByRole("button", { name: "Save" }).first().click();
await member.getByText("Saved.").first().waitFor({ timeout: 10_000 }).catch(() => {});
check("member can update their own profile", (await q("select 1 from people where email_normalized = 'vol@test.local' and display_name = 'Val V'")).length === 1);
check("member pages fit a 375px phone", await noHorizontalScroll(member));

// --- Legacy rota URLs go to the Hub
await member.goto(`${APP}/my-duties`);
check("old /my-duties goes to Hub Home", new URL(member.url()).pathname === "/home", member.url());

await finish();
