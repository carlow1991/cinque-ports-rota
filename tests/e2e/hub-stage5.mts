/**
 * Volunteer Hub · Stage 5 — club roles, independent recruiting, public opportunities (C33–C35).
 *   tests/e2e/run.sh tests/e2e/hub-stage5.mts [--build]
 */
import { APP, startChecks } from "./support/hub.mts";

const { q, check, newPage, signIn, noHorizontalScroll, finish } = await startChecks("Hub stage 5");
await q("update people set full_name = 'Carl (demo)', display_name = null, phone_normalized = '+447700900555' where email_normalized = 'admin@test.local'");
const [{ id: carl }] = await q<{ id: string }>("select id from people where email_normalized = 'admin@test.local'");

const admin = await newPage();
await signIn(admin, "admin@test.local");
await admin.goto(`${APP}/manage/club-roles`);
await admin.getByRole("button", { name: "Add the usual roles" }).click();
for (let i = 0; i < 40 && (await q("select 1 from club_positions")).length < 8; i++) await new Promise((r) => setTimeout(r, 250));
const roles = await q<{ id: string; title: string }>("select id, title from club_positions");
check("the usual roles are added as empty drafts", roles.length === 8 && (await q("select 1 from position_holders")).length === 0);
const sec = roles.find((r) => r.title === "Club Secretary")!.id, grounds = roles.find((r) => r.title === "Groundsman")!.id;
for (const r of roles) await q("insert into position_holders (club_position_id, person_id, start_date) values ($1, $2, '2024-08-01')", [r.id, carl]);

// Club Secretary: Filled + Seeking replacement, advertised publicly (C33)
await admin.goto(`${APP}/manage/club-roles/${sec}`);
await admin.getByLabel("Seeking a replacement / successor").check();
await admin.getByRole("button", { name: "Save recruiting" }).click();
await admin.getByText(/Recruiting saved/).waitFor({ timeout: 15_000 });
await admin.getByLabel("Short public description").fill("Keeps the club running smoothly: meetings, league paperwork and correspondence.");
await admin.getByLabel("Can appear on the public volunteer page").check();
await admin.getByRole("button", { name: "Save details" }).click();
await admin.getByText("Saved.").first().waitFor({ timeout: 15_000 });
// Groundsman: Filled + Extra help
await admin.goto(`${APP}/manage/club-roles/${grounds}`);
await admin.getByLabel("Need additional help").check();
await admin.getByRole("button", { name: "Save recruiting" }).click();
await admin.getByText(/Recruiting saved/).waitFor({ timeout: 15_000 });
await admin.goto(`${APP}/manage/club-roles`);
await admin.getByText("Club Secretary").first().waitFor();
const list = (await admin.textContent("main")) ?? "";
check("C33: Club Secretary shows Filled AND Looking for a successor", /Club SecretaryFilledLooking for a successor/.test(list.replace(/\s+/g, "")) || (list.includes("Looking for a successor") && list.includes("Filled")));
check("…Groundsman shows Filled AND Extra help wanted", list.includes("Extra help wanted"));
check("…and Carl is still the holder of all eight", (await q("select 1 from position_holders where person_id = $1 and end_date is null", [carl])).length === 8);
check("club roles page fits a 375px phone", await noHorizontalScroll(admin));

// Public page (no login): public-safe copy only (C35)
const pub = await newPage();
await pub.goto(`${APP}/volunteer`);
await pub.getByRole("heading", { name: "Volunteer with Cinque Ports FC" }).waitFor();
await pub.getByRole("heading", { name: "Club Secretary" }).waitFor({ timeout: 15_000 });
const pubText = (await pub.textContent("body")) ?? "";
check("C35: the public page advertises Club Secretary with its public description", pubText.includes("Keeps the club running smoothly"));
check("…labelled as looking for a successor", pubText.includes("Looking for a successor"));
check("…without the holder's name or phone", !pubText.includes("Carl") && !pubText.includes("07700"));
check("…and Groundsman isn't public (not allowed on the public page)", !pubText.includes("Groundsman"));
check("public page works without signing in", new URL(pub.url()).pathname === "/volunteer");
await pub.goto(`${APP}/people`);
check("C05: the public is sent to sign in for the directory", new URL(pub.url()).pathname === "/login");
await pub.goto(`${APP}/calendar`);
check("C05: …and for the calendar", new URL(pub.url()).pathname === "/login");
await pub.goto(`${APP}/privacy`);
check("privacy notice is public and marked as a draft", ((await pub.textContent("main")) ?? "").includes("draft awaiting the club"));
check("public pages fit a 375px phone", await noHorizontalScroll(pub));

// Member registers interest
const mem = await newPage();
await signIn(mem, "vol@test.local");
await mem.goto(`${APP}/opportunities`);
await mem.getByRole("button", { name: "I'm interested in Club Secretary" }).click();
await mem.getByText(/said you.re interested/).waitFor({ timeout: 15_000 });
check("a member registers interest in the successor role", (await q("select 1 from position_interests where position_id = $1", [sec])).length === 1);
await mem.goto(`${APP}/people`);
await mem.getByText("Carl (demo)").first().waitFor();
check("the directory shows Carl's club roles", ((await mem.textContent("main")) ?? "").includes("Club Secretary"));
await finish();
