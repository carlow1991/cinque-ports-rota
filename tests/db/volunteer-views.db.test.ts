import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { authorise, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, seedAssignment, venueId, type Person } from "./fixtures";

let db: TestDb;
let mw: string, fw: string;
let coord: Person, me: Person, other: Person, suspended: Person;
let pub: string, draft: string, past: string;
let setup: string, lead: string, approval: string, clash: string, full: string, organiserOnly: string;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  coord = await makeCoordinator(db, [mw, fw]);
  me = await person(db, "volunteer", { name: "Me Volunteer" });
  other = await person(db, "volunteer", { name: "Other Person" });
  suspended = await person(db, "volunteer", { active: false });
  await db.admin.query("update volunteers set phone = '07700 900999' where id = $1", [other.id]);

  pub = await makeEvent(db, { venue: mw, start: inHours(100), end: inHours(102), title: "Published fixture" });
  setup = await makeShift(db, { event: pub, duty: "pitch_setup", start: inHours(99), end: inHours(100), required: 2 });
  lead = await makeShift(db, { event: pub, duty: "site_lead", start: inHours(99), end: inHours(103), responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
  approval = await makeShift(db, { event: pub, duty: "gate_admissions", start: inHours(100), end: inHours(101), approval: true });
  full = await makeShift(db, { event: pub, duty: "cleaning", start: inHours(102), end: inHours(103), required: 1 });
  organiserOnly = await makeShift(db, { event: pub, duty: "general_support", start: inHours(100), end: inHours(102), signup: false });
  await seedAssignment(db, full, other.id, "confirmed");

  // A clash: I'm already confirmed elsewhere at 100–101.
  const elsewhere = await makeEvent(db, { venue: fw, start: inHours(100), end: inHours(101), title: "Elsewhere" });
  const elsewhereShift = await makeShift(db, { event: elsewhere, duty: "refreshments", start: inHours(100), end: inHours(101) });
  await seedAssignment(db, elsewhereShift, me.id, "confirmed");
  clash = approval; // gate 100–101 clashes with elsewhere

  draft = await makeEvent(db, { venue: mw, start: inHours(110), end: inHours(112), status: "draft", title: "Draft event" });
  await makeShift(db, { event: draft, duty: "cleaning", start: inHours(110), end: inHours(111) });
  past = await makeEvent(db, { venue: mw, start: inHours(-30), end: inHours(-28), title: "Past fixture" });
  const pastShift = await makeShift(db, { event: past, duty: "cleaning", start: inHours(-28), end: inHours(-27) });
  const pa = await seedAssignment(db, pastShift, me.id, "confirmed");
  await db.admin.query("update assignments set attendance_status = 'present' where id = $1", [pa]);
});
afterAll(async () => db?.drop());

const asMe = <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => db.asUser(me.uid, (c) => rows<T>(c, sql, p));

describe("volunteer_rota", () => {
  it("lists only upcoming PUBLISHED events, never drafts or past ones", async () => {
    const r = await asMe<{ title: string }>("select title from public.volunteer_rota($1, $2)", [inHours(-100), inHours(1000)]);
    const titles = r.map((x) => x.title);
    expect(titles).toContain("Published fixture");
    expect(titles).not.toContain("Draft event");
    expect(titles).not.toContain("Past fixture");
  });

  it("counts open sign-up places and the ones I can actually take", async () => {
    const [r] = await asMe<{ open_slots: number; eligible_open_slots: number; my_active_count: number }>(
      "select open_slots, eligible_open_slots, my_active_count from public.volunteer_rota($1, $2) where title = 'Published fixture'", [inHours(0), inHours(1000)]);
    // open: setup 2 + lead 1 + gate 1 + cleaning 0 (full) = 4 (organiser-only duty not counted)
    // eligible for me: setup 2 only (lead needs authorisation; gate clashes with my other duty)
    expect(r).toEqual({ open_slots: 4, eligible_open_slots: 2, my_active_count: 0 });
  });

  it("venue filter", async () => {
    const r = await asMe<{ venue_name: string }>("select distinct venue_name from public.volunteer_rota($1, $2, $3)", [inHours(0), inHours(1000), fw]);
    expect(r.map((x) => x.venue_name)).toEqual(["Freemens Way"]);
  });

  it("returns nothing to suspended or anonymous callers", async () => {
    expect(await db.asUser(suspended.uid, (c) => rows(c, "select * from public.volunteer_rota($1, $2)", [inHours(0), inHours(1000)]))).toEqual([]);
    await expect(db.asAnon((c) => c.query("select * from public.volunteer_rota($1, $2)", [inHours(0), inHours(1000)]))).rejects.toThrow(/permission denied/);
  });
});

describe("volunteer_event_view", () => {
  type V = { shift_id: string; duty_name: string; open_slots: number; my_status: string | null; missing_authorisations: string[]; has_overlap: boolean; responsibilities: string[]; signup_enabled: boolean };
  const view = () => asMe<V>("select * from public.volunteer_event_view($1)", [pub]);

  it("explains why I can't take a duty: authorisation (by duty name) and clashes", async () => {
    const v = await view();
    const leadRow = v.find((x) => x.shift_id === lead)!;
    expect(leadRow.missing_authorisations).toEqual(["Site lead / duty manager", "Open and unlock facilities", "Lock and secure facilities"]);
    expect(leadRow.responsibilities).toEqual(["Open and unlock facilities", "Lock and secure facilities", "Changing room / facility checks"].sort((a, b) =>
      ["Open and unlock facilities", "Lock and secure facilities", "Changing room / facility checks"].indexOf(a) - ["Open and unlock facilities", "Lock and secure facilities", "Changing room / facility checks"].indexOf(b)));
    expect(v.find((x) => x.shift_id === clash)!.has_overlap).toBe(true);
    expect(v.find((x) => x.shift_id === setup)!).toMatchObject({ has_overlap: false, missing_authorisations: [], open_slots: 2 });
  });

  it("returns counts only: no other volunteer's id, name, email or phone anywhere", async () => {
    const raw = JSON.stringify(await view());
    expect(raw).not.toContain(other.id);
    expect(raw).not.toContain("Other Person");
    expect(raw).not.toContain(other.email);
    expect(raw).not.toContain("07700");
  });

  it("shows my own status after signing up; authorisation lets me see the lead as available", async () => {
    await rpc(db, me, "self_signup", [setup]);
    for (const c of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, me.id, c);
    const v = await view();
    expect(v.find((x) => x.shift_id === setup)!.my_status).toBe("confirmed");
    expect(v.find((x) => x.shift_id === lead)!.missing_authorisations).toEqual([]);
  });

  it("draft events are invisible to volunteers", async () => {
    expect(await asMe("select * from public.volunteer_event_view($1)", [draft])).toEqual([]);
  });

  it("organiser-allocated duties are listed but marked not open for sign-up", async () => {
    const v = await view();
    expect(v.find((x) => x.shift_id === organiserOnly)!.signup_enabled).toBe(false);
  });
});

describe("my_duties", () => {
  it("returns only my rows, including past ones with attendance, and the withdrawal deadline", async () => {
    const r = await asMe<{ event_title: string; status: string; attendance_status: string; withdraw_deadline: Date; starts_at: Date }>("select * from public.my_duties()");
    expect(r.map((x) => x.event_title).sort()).toEqual(["Elsewhere", "Past fixture", "Published fixture"]);
    expect(r.find((x) => x.event_title === "Past fixture")!.attendance_status).toBe("present");
    const pubRow = r.find((x) => x.event_title === "Published fixture")!;
    expect(pubRow.starts_at.getTime() - pubRow.withdraw_deadline.getTime()).toBe(24 * 3600_000);
  });

  it("an invitation appears with source admin_allocation; cancelled events keep their reason", async () => {
    const ev = await makeEvent(db, { venue: mw, start: inHours(300), end: inHours(302), title: "Will be cancelled" });
    const s = await makeShift(db, { event: ev, duty: "cleaning", start: inHours(302), end: inHours(303) });
    await rpc(db, coord, "allocate_volunteer", [s, me.id]);
    let r = await asMe<{ event_title: string; status: string; source: string }>("select event_title, status, source from public.my_duties() where event_title = 'Will be cancelled'");
    expect(r[0]).toEqual({ event_title: "Will be cancelled", status: "invited", source: "admin_allocation" });
    await rpc(db, coord, "cancel_event", [ev, "Pitch closed"]);
    const c = await asMe<{ status: string; event_status: string; event_status_reason: string }>("select status, event_status, event_status_reason from public.my_duties() where event_title = 'Will be cancelled'");
    expect(c[0]).toEqual({ status: "cancelled", event_status: "cancelled", event_status_reason: "Pitch closed" });
    r = await db.asUser(other.uid, (cl) => rows(cl, "select event_title from public.my_duties()"));
    expect(r.map((x) => (x as { event_title: string }).event_title)).not.toContain("Will be cancelled");
  });

  it("shows a pending late-cancellation request", async () => {
    const ev = await makeEvent(db, { venue: mw, start: inHours(5), end: inHours(7), title: "Soon" });
    const s = await makeShift(db, { event: ev, duty: "cleaning", start: inHours(7), end: inHours(8) });
    const a = await rpc<{ assignment_id: string }>(db, me, "self_signup", [s]);
    await rpc(db, me, "request_cancellation", [a.assignment_id, "Unwell"]);
    const [r] = await asMe<{ status: string; cancellation_pending: boolean }>("select status, cancellation_pending from public.my_duties() where event_title = 'Soon'");
    expect(r).toEqual({ status: "confirmed", cancellation_pending: true });
  });
});

describe("volunteer_opportunities", () => {
  type O = { shift_id: string; duty_name: string; open_slots: number; event_title: string };
  const opps = (who: Person) => db.asUser(who.uid, (c) => rows<O>(c,
    "select shift_id, duty_name, open_slots, event_title from public.volunteer_opportunities($1, $2)", [inHours(-48), inHours(1000)]));

  it("lists only duties I can take now: not restricted, clashing, full, organiser-filled, draft or past", async () => {
    const fresh = await person(db, "volunteer", { name: "Fresh Face" });
    const ev = await makeEvent(db, { venue: fw, start: inHours(600), end: inHours(602), title: "Opps fixture" });
    const ok = await makeShift(db, { event: ev, duty: "pitch_setup", start: inHours(599), end: inHours(600), required: 2 });
    await makeShift(db, { event: ev, duty: "site_lead", start: inHours(599), end: inHours(603) });                    // restricted
    await makeShift(db, { event: ev, duty: "general_support", start: inHours(600), end: inHours(602), signup: false }); // organiser fills
    const f = await makeShift(db, { event: ev, duty: "cleaning", start: inHours(602), end: inHours(603), required: 1 });
    await seedAssignment(db, f, other.id, "confirmed");                                                               // full
    const gate = await makeShift(db, { event: ev, duty: "gate_admissions", start: inHours(600), end: inHours(601) });
    const elsewhere = await makeEvent(db, { venue: mw, start: inHours(600), end: inHours(601) });
    await seedAssignment(db, await makeShift(db, { event: elsewhere, duty: "refreshments", start: inHours(600), end: inHours(601) }), fresh.id, "confirmed"); // clash with gate
    const d = await makeEvent(db, { venue: fw, start: inHours(610), end: inHours(611), status: "draft" });
    await makeShift(db, { event: d, duty: "cleaning", start: inHours(610), end: inHours(611) });                    // draft
    const o = (await opps(fresh)).filter((x) => x.event_title === "Opps fixture");
    expect(o.map((x) => x.shift_id)).toEqual([ok]);
    expect(o[0]).toMatchObject({ open_slots: 2 });
    expect(gate).not.toBe(ok);
  });

  it("agrees with the rota's 'places you can take' count", async () => {
    const [rota] = await asMe<{ eligible_open_slots: number }>(
      "select eligible_open_slots from public.volunteer_rota($1, $2) where event_id = $3", [inHours(-48), inHours(1000), pub]);
    const total = (await opps(me)).filter((x) => x.event_title === "Published fixture").reduce((n, x) => n + x.open_slots, 0);
    expect(total).toBe(rota.eligible_open_slots);
  });

  it("suspended or signed-out people get nothing; no names or contact details are returned", async () => {
    expect(await opps(suspended)).toEqual([]);
    const all = JSON.stringify(await db.asUser(other.uid, (c) => rows(c, "select * from public.volunteer_opportunities($1, $2)", [inHours(-48), inHours(1000)])));
    expect(all).not.toContain("07700");
    expect(all).not.toContain("@");
  });
});
