import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { authorise, expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, seedAssignment, venueId, type Person } from "./fixtures";

let db: TestDb;
let mw: string, fw: string;
let admin: Person, coord: Person;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  admin = await person(db, "admin");
  coord = await makeCoordinator(db, [mw, fw]);
});
afterAll(async () => db?.drop());

type Coverage = { state: string; coverage_event_id: string | null; required_window: string; gaps: string };
const coverage = async (event: string) =>
  (await db.asUser(coord.uid, (c) => rows<Coverage>(c, "select state, coverage_event_id, required_window::text, gaps::text from public.event_site_coverage($1)", [event])))[0];

async function lead(withAuth = true) {
  const p = await person(db);
  if (withAuth) for (const c of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, p.id, c);
  return p;
}

/** Catalogue §6 example: Freemens Way Saturday ops 08:00–14:00 (here: base+0h..base+6h). */
async function saturdayOps(base: number) {
  const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(base), end: inHours(base + 6), title: "FW Saturday operations" });
  const leadShift = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(base), end: inHours(base + 6),
    responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
  // Youth block 09:00–12:00 with setup from 08:15 and cleaning to 12:30 → required window 08:15–12:30.
  const youth = await makeEvent(db, { venue: fw, start: inHours(base + 1), end: inHours(base + 4), coverageEventId: cover, title: "Youth block" });
  await makeShift(db, { event: youth, duty: "pitch_setup", start: inHours(base + 0.25), end: inHours(base + 1), required: 2 });
  await makeShift(db, { event: youth, duty: "cleaning", start: inHours(base + 4), end: inHours(base + 4.5) });
  // Additional activity 12:00–13:30.
  const extra = await makeEvent(db, { venue: fw, start: inHours(base + 4), end: inHours(base + 5.5), coverageEventId: cover, title: "Additional activity" });
  await makeShift(db, { event: extra, duty: "general_support", start: inHours(base + 4), end: inHours(base + 5.5) });
  return { cover, leadShift, youth, extra };
}

describe("coverage links: same venue, no cycles", () => {
  it("rejects a link to another venue, to a non-coverage event, to itself, and from a coverage event", async () => {
    const coverFW = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(10), end: inHours(20) });
    const coverFW2 = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(10), end: inHours(20) });
    const fixtureFW = await makeEvent(db, { venue: fw, start: inHours(11), end: inHours(12) });
    await expect(makeEvent(db, { venue: mw, start: inHours(11), end: inHours(12), coverageEventId: coverFW })).rejects.toThrow(/coverage_link_other_venue/);
    await expect(makeEvent(db, { venue: fw, start: inHours(11), end: inHours(12), coverageEventId: fixtureFW })).rejects.toThrow(/coverage_link_not_coverage/);
    await expect(db.admin.query("update events set coverage_event_id = id where id = $1", [fixtureFW])).rejects.toThrow(/coverage_link_self|events_coverage_not_self/);
    await expect(db.admin.query("update events set coverage_event_id = $2 where id = $1", [coverFW2, coverFW])).rejects.toThrow(/coverage_link_from_coverage/);
  });

  it("a coverage event with dependents cannot change venue or type", async () => {
    const c = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(30), end: inHours(40) });
    await makeEvent(db, { venue: fw, start: inHours(31), end: inHours(32), coverageEventId: c });
    await expect(db.admin.query("update events set venue_id = $2 where id = $1", [c, mw])).rejects.toThrow(/coverage_event_has_dependents/);
    await expect(db.admin.query("update events set event_type = 'fixture' where id = $1", [c])).rejects.toThrow(/coverage_event_has_dependents/);
  });

  it("a coordinator's link edit is validated the same way (and only via the RPC)", async () => {
    const coverMW = await makeEvent(db, { venue: mw, type: "venue_coverage", start: inHours(50), end: inHours(60) });
    const fixtureFW = await makeEvent(db, { venue: fw, start: inHours(51), end: inHours(52) });
    await expectCode(rpc(db, coord, "link_venue_cover", [fixtureFW, coverMW]), "coverage_link_other_venue");
    // Direct column edits are no longer allowed: links change only through link_venue_cover().
    await expect(db.asUser(coord.uid, (c) => c.query("update events set coverage_event_id = $2 where id = $1", [fixtureFW, coverMW])))
      .rejects.toThrow(/permission denied/);
  });
});

describe("full-window site-lead coverage (agreed Q5: earliest setup → end of cleaning)", () => {
  it("Catalogue §6: confirmed authorised lead 08:00–14:00 covers both linked activities", async () => {
    const w = await saturdayOps(1000);
    const l = await lead();
    await rpc(db, l, "self_signup", [w.leadShift]);
    const youth = await coverage(w.youth);
    expect(youth.state).toBe("covered_by_volunteer");
    expect(youth.gaps).toBe("{}");
    expect((await coverage(w.extra)).state).toBe("covered_by_volunteer");
    expect((await coverage(w.cover)).state).toBe("covered_by_volunteer");
  });

  it("linking alone is NOT cover: unconfirmed or invited lead → at risk with the full window as a gap", async () => {
    const w = await saturdayOps(1100);
    const l = await lead();
    await rpc(db, coord, "allocate_volunteer", [w.leadShift, l.id]);   // invited only
    const c = await coverage(w.youth);
    expect(c.state).toBe("at_risk");
    expect(c.gaps).not.toBe("{}");
  });

  it("lead cancels → BOTH linked activities at risk, organisers alerted; their own duties untouched", async () => {
    const w = await saturdayOps(1200);
    const l = await lead();
    const helper = await person(db);
    const a = await rpc<{ assignment_id: string }>(db, l, "self_signup", [w.leadShift]);
    const [setup] = await rows<{ id: string }>(db.admin, "select id from event_shifts where event_id = $1 and duty_type_id = (select id from duty_types where code='pitch_setup')", [w.youth]);
    const h = await rpc<{ assignment_id: string }>(db, helper, "self_signup", [setup.id]);
    await rpc(db, coord, "remove_assignment", [a.assignment_id, "Lead unavailable"]);
    expect((await coverage(w.youth)).state).toBe("at_risk");
    expect((await coverage(w.extra)).state).toBe("at_risk");
    const [st] = await rows<{ status: string }>(db.admin, "select status from assignments where id = $1", [h.assignment_id]);
    expect(st.status).toBe("confirmed");
  });

  it("cancelling the coverage event alerts organisers of every linked event", async () => {
    const w = await saturdayOps(1300);
    await rpc(db, coord, "cancel_event", [w.cover, "Facility closed"]);
    const alerts = await rows<{ entity_id: string }>(db.admin,
      "select distinct entity_id from notification_outbox where kind = 'venue_cover_at_risk' and entity_id in ($1, $2)", [w.youth, w.extra]);
    expect(alerts.map((a) => a.entity_id).sort()).toEqual([w.youth, w.extra].sort());
    expect((await coverage(w.youth)).state).toBe("at_risk");
  });

  it("a lead covering only part of the window leaves a reported gap", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(1400), end: inHours(1406) });
    const early = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(1400), end: inHours(1402) });
    const youth = await makeEvent(db, { venue: fw, start: inHours(1401), end: inHours(1404), coverageEventId: cover });
    const l = await lead();
    await rpc(db, l, "self_signup", [early]);
    const c = await coverage(youth);
    expect(c.state).toBe("at_risk");
    expect(c.gaps).toMatch(/^\{\[/); // one or more explicit uncovered intervals
  });

  it("split handover with no gap is covered; with a gap it is not", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(1500), end: inHours(1506) });
    const am = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(1500), end: inHours(1503) });
    const pm = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(1503), end: inHours(1506) });
    const youth = await makeEvent(db, { venue: fw, start: inHours(1501), end: inHours(1505), coverageEventId: cover });
    const [l1, l2] = [await lead(), await lead()];
    await rpc(db, l1, "self_signup", [am]);
    expect((await coverage(youth)).state).toBe("at_risk");
    await rpc(db, l2, "self_signup", [pm]);
    expect((await coverage(youth)).state).toBe("covered_by_volunteer");
  });

  it("a lead's pending late cancellation request → at risk with the exact gap; declining restores cover", async () => {
    const w = await saturdayOps(8);
    const l = await lead();
    const a = await rpc<{ assignment_id: string }>(db, l, "self_signup", [w.leadShift]);
    expect((await coverage(w.youth)).state).toBe("covered_by_volunteer");
    const req = await rpc<{ request_id: string }>(db, l, "request_cancellation", [a.assignment_id, "Away"]);
    const c = await coverage(w.youth);
    expect(c.state).toBe("at_risk");
    // The whole required window (setup 08:15 → cleaning 12:30 in the §6 example) is now a gap.
    const [win] = await rows<{ gap: string }>(db.admin, "select tstzmultirange($1::tstzrange)::text as gap", [c.required_window]);
    expect(c.gaps).toBe(win.gap);
    expect(await rows(db.admin, "select 1 from assignments where id = $1 and status = 'confirmed'", [a.assignment_id])).toHaveLength(1);
    await rpc(db, coord, "resolve_cancellation_request", [req.request_id, false]);
    expect((await coverage(w.youth)).state).toBe("covered_by_volunteer");
  });

  it("an approved late cancellation leaves the event at risk", async () => {
    const w = await saturdayOps(9);
    const l = await lead();
    const a = await rpc<{ assignment_id: string }>(db, l, "self_signup", [w.leadShift]);
    const req = await rpc<{ request_id: string }>(db, l, "request_cancellation", [a.assignment_id, "Away"]);
    await rpc(db, coord, "resolve_cancellation_request", [req.request_id, true]);
    expect((await coverage(w.youth)).state).toBe("at_risk");
  });

  it("a confirmed lead whose authorisation lapses no longer counts", async () => {
    const w = await saturdayOps(1600);
    const l = await lead();
    await rpc(db, l, "self_signup", [w.leadShift]);
    expect((await coverage(w.youth)).state).toBe("covered_by_volunteer");
    await rpc(db, admin, "set_duty_authorisation", [l.id, "lock_secure", false, null]);
    expect((await coverage(w.youth)).state).toBe("at_risk");
  });

  it("a confirmed lead who is suspended no longer counts", async () => {
    const w = await saturdayOps(1700);
    const l = await lead();
    await rpc(db, l, "self_signup", [w.leadShift]);
    await rpc(db, admin, "admin_set_volunteer_access", [l.id, "volunteer", false]);
    expect((await coverage(w.youth)).state).toBe("at_risk");
  });

  it("no link and no lead shift → no_cover", async () => {
    const e = await makeEvent(db, { venue: mw, start: inHours(1800), end: inHours(1802) });
    expect((await coverage(e)).state).toBe("no_cover");
  });

  it("provider-verified cover is a distinct state (and admin-only, with a reason)", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(1900), end: inHours(1906) });
    const youth = await makeEvent(db, { venue: fw, start: inHours(1901), end: inHours(1904), coverageEventId: cover });
    await expectCode(rpc(db, coord, "set_site_cover", [cover, "provider_verified", "Council staff"]), "not_authorised");
    await expectCode(rpc(db, admin, "set_site_cover", [cover, "provider_verified", " "]), "reason_required");
    await rpc(db, admin, "set_site_cover", [cover, "provider_verified", "Leisure centre duty manager, confirmed by phone"]);
    expect((await coverage(youth)).state).toBe("covered_by_provider");
    const [e] = await rows<{ external_cover_verified_by: string }>(db.admin, "select external_cover_verified_by from events where id = $1", [cover]);
    expect(e.external_cover_verified_by).toBe(admin.id);
  });

  it("not_required / no site responsibility", async () => {
    const e = await makeEvent(db, { venue: mw, start: inHours(2000), end: inHours(2002), siteResponsibility: false });
    expect((await coverage(e)).state).toBe("not_required");
  });
});

describe("publishing requires an explicit site-cover decision", () => {
  async function draft(o: { cover?: string; site?: boolean; withLead?: boolean } = {}) {
    const e = await makeEvent(db, { venue: fw, start: inHours(3000), end: inHours(3002), status: "draft", coverageEventId: o.cover ?? null, siteResponsibility: o.site ?? true });
    await makeShift(db, { event: e, duty: "pitch_setup", start: inHours(2999), end: inHours(3000) });
    if (o.withLead) await makeShift(db, { event: e, duty: "site_lead", start: inHours(2999), end: inHours(3002) });
    return e;
  }

  it("blocked when the club is responsible and there is no lead shift, link or recorded decision", async () => {
    await expectCode(rpc(db, coord, "publish_event", [await draft()]), "publish_blocked");
  });
  it("allowed with its own site-lead shift", async () => {
    expect((await rpc<{ status: string }>(db, coord, "publish_event", [await draft({ withLead: true })])).status).toBe("published");
  });
  it("allowed when linked to venue cover (T03 pattern: no duplicate site-lead row needed)", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(2998), end: inHours(3004) });
    const e = await draft({ cover });
    expect((await rpc<{ status: string }>(db, coord, "publish_event", [e])).status).toBe("published");
    const leads = await rows(db.admin, "select 1 from event_shifts s join duty_types d on d.id = s.duty_type_id where s.event_id = $1 and d.code = 'site_lead'", [e]);
    expect(leads).toHaveLength(0);
  });
  it("allowed when an admin records provider cover or not-required", async () => {
    const e = await draft();
    await rpc(db, admin, "set_site_cover", [e, "not_required", "Hirer manages the site under their own agreement"]);
    expect((await rpc<{ status: string }>(db, coord, "publish_event", [e])).status).toBe("published");
  });
  it("allowed when the club is not responsible for the site", async () => {
    expect((await rpc<{ status: string }>(db, coord, "publish_event", [await draft({ site: false })])).status).toBe("published");
  });
  it("an event with no duties cannot be published", async () => {
    const e = await makeEvent(db, { venue: fw, start: inHours(3100), end: inHours(3102), status: "draft", siteResponsibility: false });
    await expectCode(rpc(db, coord, "publish_event", [e]), "publish_blocked");
  });
});

describe("overlapping events at one venue", () => {
  it("events may overlap at the same venue and at both venues at once", async () => {
    const a = await makeEvent(db, { venue: mw, start: inHours(4000), end: inHours(4003) });
    const b = await makeEvent(db, { venue: mw, start: inHours(4001), end: inHours(4004) });
    const c = await makeEvent(db, { venue: fw, start: inHours(4000), end: inHours(4003) });
    expect([a, b, c].every(Boolean)).toBe(true);
  });
});

describe("demo data never sends email", () => {
  it("outbox rows for demo events are created as suppressed", async () => {
    const v = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(5000), end: inHours(5002), isDemo: true, title: "DEMO fixture" });
    const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(5002), end: inHours(5003) });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [s]);
    const [o] = await rows<{ status: string; payload: { demo: boolean } }>(db.admin, "select status, payload from notification_outbox where entity_id = $1", [a.assignment_id]);
    expect(o.status).toBe("suppressed");
    expect(o.payload.demo).toBe(true);
  });
});

describe("misc integrity", () => {
  it("rejects invalid intervals, zero headcount and a responsibility repeating the primary duty", async () => {
    const e = await makeEvent(db, { venue: mw, start: inHours(6000), end: inHours(6002) });
    await expect(makeEvent(db, { venue: mw, start: inHours(6002), end: inHours(6000) })).rejects.toThrow(/events_valid_interval/);
    await expect(makeShift(db, { event: e, duty: "cleaning", start: inHours(6002), end: inHours(6001) })).rejects.toThrow(/event_shifts_valid_interval/);
    await expect(makeShift(db, { event: e, duty: "cleaning", start: inHours(6000), end: inHours(6001), required: 0 })).rejects.toThrow(/required_count/);
    await expect(makeShift(db, { event: e, duty: "site_lead", start: inHours(6000), end: inHours(6001), responsibilities: ["site_lead"] })).rejects.toThrow(/responsibility_is_primary/);
  });
  it("a shift may start before and end after its event (but within 24h)", async () => {
    const e = await makeEvent(db, { venue: mw, start: inHours(6100), end: inHours(6102) });
    await makeShift(db, { event: e, duty: "pitch_setup", start: inHours(6098.75), end: inHours(6099.75) });
    await makeShift(db, { event: e, duty: "cleaning", start: inHours(6102), end: inHours(6102.75) });
    await expect(makeShift(db, { event: e, duty: "cleaning", start: inHours(6130), end: inHours(6131) })).rejects.toThrow(/shift_outside_event_window/);
  });
  it("cross-midnight shifts are valid", async () => {
    const day = new Date(); day.setUTCDate(day.getUTCDate() + 30); day.setUTCHours(22, 0, 0, 0);
    const e = await makeEvent(db, { venue: mw, start: day, end: new Date(day.getTime() + 3 * 3600_000) });
    const s = await makeShift(db, { event: e, duty: "lock_secure", start: new Date(day.getTime() + 2 * 3600_000), end: new Date(day.getTime() + 4 * 3600_000) });
    expect(s).toBeTruthy();
  });
  it("seedAssignment helper still respects history: no deletes are possible for organisers", async () => {
    const v = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(6200), end: inHours(6202) });
    const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(6200), end: inHours(6202) });
    await seedAssignment(db, s, v.id, "confirmed");
    await expect(db.asUser(coord.uid, (c) => c.query("delete from assignments where shift_id = $1", [s]))).rejects.toThrow(/permission denied/);
    await expect(db.asUser(admin.uid, (c) => c.query("delete from events where id = $1", [e]))).rejects.toThrow(/permission denied/);
  });
});

describe("increment 7: guided handover split and extra §7 acceptance cases", () => {
  type Resp = { code: string };
  const respOf = (shift: string) => rows<Resp>(db.admin,
    "select d.code from event_shift_responsibilities r join duty_types d on d.id = r.duty_type_id where r.shift_id = $1 order by d.code", [shift]);

  it("splits a site lead into two parts that meet exactly; opening stays first, locking moves second", async () => {
    const w = await saturdayOps(1700);                       // lead 1700h–1706h incl. open, checks, lock
    const r = await rpc<{ first_shift_id: string; second_shift_id: string }>(db, coord, "split_site_lead_shift", [w.leadShift, inHours(1703)]);
    const [a] = await rows<{ starts_at: Date; ends_at: Date; source_template_item_id: string | null }>(db.admin, "select starts_at, ends_at, source_template_item_id from event_shifts where id = $1", [r.first_shift_id]);
    const [b] = await rows<{ starts_at: Date; ends_at: Date }>(db.admin, "select starts_at, ends_at from event_shifts where id = $1", [r.second_shift_id]);
    expect(a.ends_at.getTime()).toBe(b.starts_at.getTime());
    expect([a.starts_at.getTime(), b.ends_at.getTime()]).toEqual([inHours(1700).getTime(), inHours(1706).getTime()]);
    expect((await respOf(r.first_shift_id)).map((x) => x.code)).toEqual(["facility_checks", "open_unlock"]);
    expect((await respOf(r.second_shift_id)).map((x) => x.code)).toEqual(["facility_checks", "lock_secure"]);
    expect(a.source_template_item_id).toBeNull();
    // Only the first half confirmed → at risk with exactly the second half as the gap; both → covered.
    const [l1, l2] = [await lead(), await lead()];
    await rpc(db, l1, "self_signup", [r.first_shift_id]);
    const half = await coverage(w.youth);
    expect(half.state).toBe("at_risk");
    const [gap] = await rows<{ g: string }>(db.admin, "select tstzmultirange(tstzrange($1::timestamptz, $2::timestamptz, '[)'))::text as g", [inHours(1703), inHours(1704.5)]);
    expect(half.gaps).toBe(gap.g);
    await rpc(db, l2, "self_signup", [r.second_shift_id]);
    expect((await coverage(w.youth)).state).toBe("covered_by_volunteer");
  });

  it("each part needs only its own authorisations (opening vs locking)", async () => {
    const w = await saturdayOps(1800);
    const r = await rpc<{ first_shift_id: string; second_shift_id: string }>(db, coord, "split_site_lead_shift", [w.leadShift, inHours(1803)]);
    const closer = await person(db);
    for (const c of ["site_lead", "lock_secure"]) await authorise(db, closer.id, c);    // can lock up, can't open up
    await expectCode(rpc(db, closer, "self_signup", [r.first_shift_id]), "not_eligible");
    expect((await rpc<{ status: string }>(db, closer, "self_signup", [r.second_shift_id])).status).toBe("confirmed");
  });

  it("refuses: someone already on it, handover too close to an end, not a site lead, another venue's coordinator", async () => {
    const w = await saturdayOps(1900);
    const l = await lead();
    await rpc(db, coord, "allocate_volunteer", [w.leadShift, l.id]);                    // invited counts as someone on it
    await expectCode(rpc(db, coord, "split_site_lead_shift", [w.leadShift, inHours(1903)]), "shift_has_people");
    const w2 = await saturdayOps(1910);
    await expectCode(rpc(db, coord, "split_site_lead_shift", [w2.leadShift, new Date(inHours(1910).getTime() + 10 * 60_000)]), "invalid_handover");
    const [setup] = await rows<{ id: string }>(db.admin, "select id from event_shifts where event_id = $1 limit 1", [w2.youth]);
    await expectCode(rpc(db, coord, "split_site_lead_shift", [setup.id, inHours(1910.5)]), "not_site_lead");
    const other = await makeCoordinator(db, [mw]);
    await expectCode(rpc(db, other, "split_site_lead_shift", [w2.leadShift, inHours(1913)]), "not_authorised");
  });

  it("a one-minute gap between two confirmed leads is still a gap", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(2000), end: inHours(2006) });
    const am = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(2000), end: inHours(2003) });
    const pm = await makeShift(db, { event: cover, duty: "site_lead", start: new Date(inHours(2003).getTime() + 60_000), end: inHours(2006) });
    const youth = await makeEvent(db, { venue: fw, start: inHours(2001), end: inHours(2005), coverageEventId: cover });
    const [l1, l2] = [await lead(), await lead()];
    await rpc(db, l1, "self_signup", [am]);
    await rpc(db, l2, "self_signup", [pm]);
    const c = await coverage(youth);
    expect(c.state).toBe("at_risk");
    const [gap] = await rows<{ g: string }>(db.admin, "select tstzmultirange(tstzrange($1::timestamptz, $2::timestamptz, '[)'))::text as g", [inHours(2003), new Date(inHours(2003).getTime() + 60_000)]);
    expect(c.gaps).toBe(gap.g);
  });

  it("a lead awaiting approval is not cover", async () => {
    const cover = await makeEvent(db, { venue: fw, type: "venue_coverage", start: inHours(2100), end: inHours(2104) });
    const s = await makeShift(db, { event: cover, duty: "site_lead", start: inHours(2100), end: inHours(2104), approval: true });
    const youth = await makeEvent(db, { venue: fw, start: inHours(2101), end: inHours(2103), coverageEventId: cover });
    const l = await lead();
    expect((await rpc<{ status: string }>(db, l, "self_signup", [s])).status).toBe("pending_approval");
    expect((await coverage(youth)).state).toBe("at_risk");
  });
});
