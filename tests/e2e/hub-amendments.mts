/**
 * Volunteer Hub · amendments (19 Oct 2026): several contact methods, club vs team-management roles,
 * team league/division.   tests/e2e/run.sh tests/e2e/hub-amendments.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub amendments");
const admin = await newPage();
await signIn(admin, "admin@test.local");

// 1. Several contact methods on My Profile
await admin.goto(`${APP}/my-profile`);
await admin.getByLabel("WhatsApp").check();
await admin.getByLabel("Email", { exact: true }).check();
await admin.getByRole("button", { name: "Save" }).first().click();
await admin.getByText("Saved.").first().waitFor({ timeout: 15_000 });
const [me] = await q<{ c: string[] }>("select contact_channels c from people where email_normalized = 'admin@test.local'");
check("My Profile saves WhatsApp and email together", JSON.stringify(me.c) === '["email","whatsapp"]', JSON.stringify(me.c));
await admin.reload();
check("…and shows both ticked again", (await admin.getByLabel("WhatsApp").isChecked()) && (await admin.getByLabel("Email", { exact: true }).isChecked()));

// 3. Team with league and division
await admin.goto(`${APP}/manage/settings`);
const add = admin.locator("form", { has: admin.getByRole("button", { name: "Add team" }) });
await add.getByLabel("New team").fill("Reserves (demo)");
await add.getByLabel("League").fill("Kent County League");
await add.getByLabel("Division").fill("Division One East");
await add.getByRole("button", { name: "Add team" }).click();
await admin.getByText("Team added.").waitFor({ timeout: 15_000 });
const [team] = await q<{ id: string; league: string; division: string }>("select id, league, division from teams where name = 'Reserves (demo)'");
check("a team is added with its league and division", team?.league === "Kent County League" && team?.division === "Division One East");

// 2. Club roles vs team management
const [{ id: scott }] = await q<{ id: string }>("insert into people (full_name) values ('Scott (demo)') returning id");
await q("insert into team_people (team_id, person_id, role_label, is_expected_by_default, active_from) values ($1, $2, 'Manager', true, current_date - 1)", [team.id, scott]);
await admin.goto(`${APP}/manage/club-roles`);
const addRole = admin.locator("form", { has: admin.getByRole("button", { name: "Add role" }) });
await addRole.getByLabel("Title (required)").fill("Reserves Coach");
await addRole.getByLabel("Type of role").selectOption("team");
await addRole.getByLabel("Team (team-management roles only)").selectOption(team.id);
await addRole.getByRole("button", { name: "Add role" }).click();
await admin.waitForURL(/\/manage\/club-roles\/[0-9a-f-]{36}$/, { timeout: 15_000 });
const kindLine = admin.getByText(/^Team management — /);
await kindLine.waitFor({ timeout: 15_000 }).catch(() => {});
check("the role's page says it's team management for that team", ((await kindLine.textContent().catch(() => "")) ?? "").includes("Reserves (demo) · Kent County League, Division One East"), (await kindLine.textContent().catch(() => "missing")) ?? "");
await q("insert into club_positions (title) values ('Club Secretary (demo)')");

const kel = await newPage();
await signIn(kel, "vol@test.local");
await kel.goto(`${APP}/opportunities`);
await kel.getByRole("heading", { name: "Team management" }).waitFor({ timeout: 15_000 });
const main = (await kel.textContent("main")) ?? "";
const tmAt = main.indexOf("Team management"), clubAt = main.indexOf("Club roles (non-playing)");
check("Roles tab has separate Team management and Club roles lists", tmAt >= 0 && clubAt > tmAt);
const tm = main.slice(tmAt, clubAt), club = main.slice(clubAt);
check("team list shows the team, league/division, manager and coach post", tm.includes("Reserves (demo)") && tm.includes("Kent County League, Division One East") && tm.includes("Scott (demo) (Manager)") && tm.includes("Reserves Coach"));
check("club list holds only the non-playing roles", club.includes("Club Secretary (demo)") && !club.includes("Reserves Coach"));
check("Roles tab fits a phone", await noHorizontalScroll(kel));
await finish();
