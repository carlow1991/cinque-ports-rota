import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import {
  authorise, expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, seedAssignment, statusOf, venueId,
  type Person,
} from "./fixtures";

let db: TestDb;
let mw: string; // Marke Wood
let fw: string; // Freemens Way
let admin: Person;
let coordMW: Person;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  admin = await person(db, "admin");
  coordMW = await makeCoordinator(db, [mw]);
});
afterAll(async () => db?.drop());

async function openShift(o: { required?: number; approval?: boolean; duty?: string; venue?: string; startH?: number; hours?: number; responsibilities?: string[]; signup?: boolean } = {}) {
  const start = inHours(o.startH ?? 72);
  const end = inHours((o.startH ?? 72) + (o.hours ?? 2));
  const event = await makeEvent(db, { venue: o.venue ?? mw, start, end });
  const shift = await makeShift(db, {
    event, duty: o.duty ?? "pitch_setup", start, end, required: o.required ?? 1, approval: o.approval,
    responsibilities: o.responsibilities, signup: o.signup,
  });
  return { event, shift };
}

describe("self sign-up", () => {
  it("open duty → confirmed, writes an outbox message for the volunteer only", async () => {
    const v = await person(db);
    const { shift } = await openShift();
    const r = await rpc<{ status: string; assignment_id: string }>(db, v, "self_signup", [shift]);
    expect(r.status).toBe("confirmed");
    const out = await rows<{ recipient_volunteer_id: string; kind: string; payload: Record<string, unknown> }>(
      db.admin, "select recipient_volunteer_id, kind, payload from notification_outbox where entity_id = $1", [r.assignment_id]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ recipient_volunteer_id: v.id, kind: "signup_confirmed" });
    expect(JSON.stringify(out[0].payload)).not.toMatch(/@|phone/i);
  });

  it("approval-required duty → pending_approval, which holds a place", async () => {
    const [a, b] = [await person(db), await person(db)];
    const { shift } = await openShift({ approval: true, required: 1 });
    expect((await rpc<{ status: string }>(db, a, "self_signup", [shift])).status).toBe("pending_approval");
    await expectCode(rpc(db, b, "self_signup", [shift]), "shift_full");
  });

  it("full duty is refused", async () => {
    const [a, b] = [await person(db), await person(db)];
    const { shift } = await openShift({ required: 1 });
    await rpc(db, a, "self_signup", [shift]);
    await expectCode(rpc(db, b, "self_signup", [shift]), "shift_full");
  });

  it("cannot sign up twice", async () => {
    const v = await person(db);
    const { shift } = await openShift({ required: 3 });
    await rpc(db, v, "self_signup", [shift]);
    await expectCode(rpc(db, v, "self_signup", [shift]), "already_assigned");
  });

  it("refused for draft events (not even visible), started duties and sign-up-disabled duties", async () => {
    const v = await person(db);
    const start = inHours(48);
    const draft = await makeEvent(db, { venue: mw, start, end: inHours(50), status: "draft" });
    const draftShift = await makeShift(db, { event: draft, duty: "cleaning", start, end: inHours(50) });
    await expectCode(rpc(db, v, "self_signup", [draftShift]), "not_found");

    const past = await makeEvent(db, { venue: mw, start: inHours(-1), end: inHours(1) });
    const pastShift = await makeShift(db, { event: past, duty: "cleaning", start: inHours(-1), end: inHours(1) });
    await expectCode(rpc(db, v, "self_signup", [pastShift]), "shift_started");

    const { shift } = await openShift({ signup: false });
    await expectCode(rpc(db, v, "self_signup", [shift]), "signup_disabled");
  });

  it("suspended volunteer cannot sign up", async () => {
    const v = await person(db, "volunteer", { active: false });
    const { shift } = await openShift();
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_authorised");
  });
});

describe("overlap prevention (any venue)", () => {
  it("rejects an overlapping duty at the OTHER venue; allows back-to-back", async () => {
    const v = await person(db);
    const a = await openShift({ venue: mw, startH: 100, hours: 3 });       // 100–103
    const clash = await openShift({ venue: fw, startH: 102, hours: 2 });   // 102–104 overlaps
    const after = await openShift({ venue: fw, startH: 103, hours: 1 });   // 103–104 back-to-back
    await rpc(db, v, "self_signup", [a.shift]);
    await expectCode(rpc(db, v, "self_signup", [clash.shift]), "overlap");
    expect((await rpc<{ status: string }>(db, v, "self_signup", [after.shift])).status).toBe("confirmed");
  });

  it("rejects an overlapping duty at the SAME venue", async () => {
    const v = await person(db);
    const a = await openShift({ venue: mw, startH: 200, hours: 3 });
    const b = await openShift({ venue: mw, startH: 201, hours: 1 });
    await rpc(db, v, "self_signup", [a.shift]);
    await expectCode(rpc(db, v, "self_signup", [b.shift]), "overlap");
  });

  it("a pending approval also blocks overlapping commitments; cancelled events do not", async () => {
    const v = await person(db);
    const p = await openShift({ approval: true, startH: 300, hours: 2 });
    await rpc(db, v, "self_signup", [p.shift]);
    const o = await openShift({ startH: 301, hours: 2 });
    await expectCode(rpc(db, v, "self_signup", [o.shift]), "overlap");
    await rpc(db, admin, "cancel_event", [p.event, "Weather"]);
    expect((await rpc<{ status: string }>(db, v, "self_signup", [o.shift])).status).toBe("confirmed");
  });
});

describe("restricted duties & authorisation expiry", () => {
  it("restricted duty needs a valid authorisation", async () => {
    const v = await person(db);
    const { shift } = await openShift({ duty: "site_lead", startH: 400 });
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_eligible");
    await authorise(db, v.id, "site_lead");
    expect((await rpc<{ status: string }>(db, v, "self_signup", [shift])).status).toBe("confirmed");
  });

  it("an authorisation that expires before the shift ends does not count", async () => {
    const v = await person(db);
    const { shift } = await openShift({ duty: "site_lead", startH: 500, hours: 4 });
    await authorise(db, v.id, "site_lead", inHours(502)); // expires mid-shift
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_eligible");
    await authorise(db, v.id, "site_lead", inHours(-1));  // already expired
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_eligible");
    await authorise(db, v.id, "site_lead", null, false);  // revoked
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_eligible");
  });

  it("composite site-lead shift needs EVERY restricted included duty (agreed Q4)", async () => {
    const v = await person(db);
    const { shift } = await openShift({ duty: "site_lead", startH: 600, responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
    await authorise(db, v.id, "site_lead");
    await authorise(db, v.id, "open_unlock");
    await expectCode(rpc(db, v, "self_signup", [shift]), "not_eligible");
    await expectCode(rpc(db, v, "self_signup", [shift]), "lock_secure"); // named in the detail
    await authorise(db, v.id, "lock_secure");
    // facility_checks is not restricted by default, so it needs no authorisation.
    expect((await rpc<{ status: string }>(db, v, "self_signup", [shift])).status).toBe("confirmed");
  });

  it("composite responsibilities count once: one slot, one headcount", async () => {
    const v = await person(db);
    for (const c of ["site_lead", "open_unlock", "lock_secure"]) await authorise(db, v.id, c);
    const { event, shift } = await openShift({ duty: "site_lead", startH: 650, responsibilities: ["open_unlock", "facility_checks", "lock_secure"] });
    await rpc(db, v, "self_signup", [shift]);
    const staffing = await db.asUser(admin.uid, (c) =>
      rows<{ required_count: number; confirmed_count: number; open_slots: number }>(c, "select * from public.event_shift_staffing($1)", [event]));
    expect(staffing).toEqual([expect.objectContaining({ required_count: 1, confirmed_count: 1, open_slots: 0 })]);
  });

  it("only an admin can grant authorisations; volunteers cannot self-authorise", async () => {
    const v = await person(db);
    await expectCode(rpc(db, v, "set_duty_authorisation", [v.id, "site_lead", true, null]), "not_authorised");
    await expectCode(rpc(db, coordMW, "set_duty_authorisation", [v.id, "site_lead", true, null]), "not_authorised");
    await expect(db.asUser(v.uid, (c) =>
      c.query("insert into volunteer_duty_authorisations (volunteer_id, duty_type_id) select $1, id from duty_types where code = 'site_lead'", [v.id]),
    )).rejects.toThrow(/permission denied/);
    const r = await rpc<{ active: boolean }>(db, admin, "set_duty_authorisation", [v.id, "site_lead", true, null]);
    expect(r.active).toBe(true);
  });
});

describe("invitations", () => {
  it("an invitation reserves no place; acceptance re-checks capacity", async () => {
    const [invitee, walkIn] = [await person(db), await person(db)];
    const { shift } = await openShift({ required: 1, startH: 700 });
    const inv = await rpc<{ assignment_id: string; status: string }>(db, coordMW, "allocate_volunteer", [shift, invitee.id]);
    expect(inv.status).toBe("invited");
    expect((await rpc<{ status: string }>(db, walkIn, "self_signup", [shift])).status).toBe("confirmed"); // not blocked by the invite
    await expectCode(rpc(db, invitee, "accept_invitation", [inv.assignment_id]), "shift_full");
    expect(await statusOf(db, inv.assignment_id)).toBe("invited");
  });

  it("accept → confirmed; decline → declined; only the invitee can respond", async () => {
    const [v, w, other] = [await person(db), await person(db), await person(db)];
    const { shift } = await openShift({ required: 2, startH: 710 });
    const a = await rpc<{ assignment_id: string }>(db, coordMW, "allocate_volunteer", [shift, v.id]);
    const b = await rpc<{ assignment_id: string }>(db, coordMW, "allocate_volunteer", [shift, w.id]);
    await expectCode(rpc(db, other, "accept_invitation", [a.assignment_id]), "not_found");
    expect((await rpc<{ status: string }>(db, v, "accept_invitation", [a.assignment_id])).status).toBe("confirmed");
    expect((await rpc<{ status: string }>(db, w, "decline_invitation", [b.assignment_id])).status).toBe("declined");
  });

  it("accepting an approval-required duty goes to pending_approval, never straight to confirmed", async () => {
    const v = await person(db);
    const { shift } = await openShift({ approval: true, startH: 720 });
    const a = await rpc<{ assignment_id: string }>(db, coordMW, "allocate_volunteer", [shift, v.id]);
    expect((await rpc<{ status: string }>(db, v, "accept_invitation", [a.assignment_id])).status).toBe("pending_approval");
    expect((await rpc<{ status: string }>(db, coordMW, "approve_assignment", [a.assignment_id])).status).toBe("confirmed");
  });

  it("cannot invite someone lacking the authorisation", async () => {
    const v = await person(db);
    const { shift } = await openShift({ duty: "lock_secure", startH: 730 });
    await expectCode(rpc(db, coordMW, "allocate_volunteer", [shift, v.id]), "not_eligible");
  });
});

describe("approvals", () => {
  it("coordinator approves/rejects at their venue only; volunteers cannot approve", async () => {
    const [v, w] = [await person(db), await person(db)];
    const coordFW = await makeCoordinator(db, [fw]);
    const { shift } = await openShift({ approval: true, required: 2, startH: 800 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    const b = await rpc<{ assignment_id: string }>(db, w, "self_signup", [shift]);
    await expectCode(rpc(db, v, "approve_assignment", [a.assignment_id]), "not_authorised");
    await expectCode(rpc(db, coordFW, "approve_assignment", [a.assignment_id]), "not_authorised");
    expect((await rpc<{ status: string }>(db, coordMW, "approve_assignment", [a.assignment_id])).status).toBe("confirmed");
    expect((await rpc<{ status: string }>(db, coordMW, "reject_assignment", [b.assignment_id, "Not needed"])).status).toBe("declined");
  });
});

describe("withdrawal and late cancellation", () => {
  it("withdraw before the 24h cutoff frees the place", async () => {
    const [v, w] = [await person(db), await person(db)];
    const { shift } = await openShift({ required: 1, startH: 48 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    expect((await rpc<{ status: string }>(db, v, "withdraw_assignment", [a.assignment_id])).status).toBe("withdrawn");
    expect((await rpc<{ status: string }>(db, w, "self_signup", [shift])).status).toBe("confirmed");
  });

  it("inside the cutoff: withdraw refused, a cancellation request keeps cover until an organiser acts", async () => {
    const v = await person(db);
    const { shift } = await openShift({ startH: 10 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    await expectCode(rpc(db, v, "withdraw_assignment", [a.assignment_id]), "inside_cutoff");
    const req = await rpc<{ request_id: string }>(db, v, "request_cancellation", [a.assignment_id, "Ill"]);
    expect(await statusOf(db, a.assignment_id)).toBe("confirmed");
    await expectCode(rpc(db, v, "request_cancellation", [a.assignment_id, "again"]), "already_requested");
    const alerts = await rows(db.admin, "select 1 from notification_outbox where kind = 'cancellation_requested' and entity_id = $1", [req.request_id]);
    expect(alerts.length).toBeGreaterThanOrEqual(2); // admin + venue coordinator
    await rpc(db, coordMW, "resolve_cancellation_request", [req.request_id, true]);
    expect(await statusOf(db, a.assignment_id)).toBe("withdrawn");
  });

  it("the cutoff is configurable", async () => {
    const v = await person(db);
    const { shift } = await openShift({ startH: 10 });
    await db.admin.query("update club_settings set withdrawal_cutoff_hours = 6");
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    expect((await rpc<{ status: string }>(db, v, "withdraw_assignment", [a.assignment_id])).status).toBe("withdrawn");
    await db.admin.query("update club_settings set withdrawal_cutoff_hours = 24");
  });

  it("organiser removal needs a reason", async () => {
    const v = await person(db);
    const { shift } = await openShift({ startH: 900 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    await expectCode(rpc(db, coordMW, "remove_assignment", [a.assignment_id, " "]), "reason_required");
    expect((await rpc<{ status: string }>(db, coordMW, "remove_assignment", [a.assignment_id, "Double booked"])).status).toBe("removed");
  });
});

describe("event cancellation", () => {
  it("cancels event, shifts and active assignments; notifies; suppresses reminders; keeps history", async () => {
    const [v, w] = [await person(db), await person(db)];
    const { event, shift } = await openShift({ required: 3, startH: 1000 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    const inv = await rpc<{ assignment_id: string }>(db, coordMW, "allocate_volunteer", [shift, w.id]);
    await db.admin.query(
      `insert into notification_outbox (recipient_volunteer_id, kind, entity_type, entity_id, dedupe_key, send_after)
       values ($1, 'reminder', 'assignments', $2::uuid, $3, now() + interval '1 day')`, [v.id, a.assignment_id, `reminder-test-${a.assignment_id}`]);
    await expectCode(rpc(db, coordMW, "cancel_event", [event, ""]), "reason_required");
    const r = await rpc<{ assignments_cancelled: number }>(db, coordMW, "cancel_event", [event, "Pitch waterlogged"]);
    expect(r.assignments_cancelled).toBe(2);
    expect(await statusOf(db, a.assignment_id)).toBe("cancelled");
    expect(await statusOf(db, inv.assignment_id)).toBe("cancelled");
    const [ev] = await rows<{ status: string }>(db.admin, "select status from events where id = $1", [event]);
    expect(ev.status).toBe("cancelled");
    const [sh] = await rows<{ status: string }>(db.admin, "select status from event_shifts where id = $1", [shift]);
    expect(sh.status).toBe("cancelled");
    const [rem] = await rows<{ status: string }>(db.admin, "select status from notification_outbox where dedupe_key = $1", [`reminder-test-${a.assignment_id}`]);
    expect(rem.status).toBe("suppressed");
    const msgs = await rows(db.admin, "select 1 from notification_outbox where kind = 'event_cancelled' and entity_id in ($1, $2)", [a.assignment_id, inv.assignment_id]);
    expect(msgs).toHaveLength(2);
    expect((await rows(db.admin, "select 1 from assignments where id = $1", [a.assignment_id])).length).toBe(1); // history kept
    await expectCode(rpc(db, v, "self_signup", [shift]), "shift_not_open");
  });

  it("a coordinator cannot cancel another venue's event", async () => {
    const { event } = await openShift({ venue: fw, startH: 1010 });
    await expectCode(rpc(db, coordMW, "cancel_event", [event, "x"]), "not_authorised");
  });
});

describe("time changes", () => {
  it("rescheduling moves shifts, resets commitments to invited, frees pending places, and notifies", async () => {
    const [v, w] = [await person(db), await person(db)];
    const start = inHours(1100);
    const end = inHours(1102);
    const event = await makeEvent(db, { venue: mw, start, end });
    const setup = await makeShift(db, { event, duty: "pitch_setup", start: inHours(1099), end: inHours(1100), required: 1 });
    const help = await makeShift(db, { event, duty: "general_support", start, end, required: 1, approval: true });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [setup]);
    const p = await rpc<{ assignment_id: string }>(db, w, "self_signup", [help]);
    const r = await rpc<{ assignments_reset: number }>(db, coordMW, "reschedule_event", [event, inHours(1124), inHours(1126)]);
    expect(r.assignments_reset).toBe(2);
    expect(await statusOf(db, a.assignment_id)).toBe("invited");
    expect(await statusOf(db, p.assignment_id)).toBe("invited");
    const [s] = await rows<{ starts_at: Date }>(db.admin, "select starts_at from event_shifts where id = $1", [setup]);
    // Hand-made shift moves with the start: 1099h → 1123h (24h later).
    expect(Math.abs(s.starts_at.getTime() - inHours(1123).getTime())).toBeLessThan(60_000);
    // Freed: someone else can now take the approval duty's place.
    const x = await person(db);
    expect((await rpc<{ status: string }>(db, x, "self_signup", [help])).status).toBe("pending_approval");
    // Re-accepting the approval duty when it's full → shift_full; when free → pending (never straight to confirmed).
    await expectCode(rpc(db, w, "accept_invitation", [p.assignment_id]), "shift_full");
    expect((await rpc<{ status: string }>(db, v, "accept_invitation", [a.assignment_id])).status).toBe("confirmed");
    const msgs = await rows(db.admin, "select 1 from notification_outbox where kind = 'reconfirm_needed' and entity_id in ($1, $2)", [a.assignment_id, p.assignment_id]);
    expect(msgs).toHaveLength(2);
  });

  it("template-anchored shifts re-anchor to the new start/end", async () => {
    const start = inHours(1200);
    const end = inHours(1202);
    const event = await makeEvent(db, { venue: mw, start, end });
    const [tmpl] = await rows<{ id: string }>(db.admin,
      "insert into duty_templates (code, name, event_type) values ('TTEST', 'Test', 'fixture') returning id");
    const [item] = await rows<{ id: string }>(db.admin,
      `insert into duty_template_items (template_id, duty_type_id, start_anchor, start_offset_minutes, end_anchor, end_offset_minutes)
       values ($1, (select id from duty_types where code = 'cleaning'), 'event_end', 0, 'event_end', 45) returning id`, [tmpl.id]);
    const [sh] = await rows<{ id: string }>(db.admin,
      `insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, source_template_item_id)
       values ($1, (select id from duty_types where code = 'cleaning'), $2, $3, 1, $4) returning id`,
      [event, end, new Date(end.getTime() + 45 * 60000), item.id]);
    // Event lengthened by an hour: cleaning must follow the END, not the start.
    await rpc(db, coordMW, "reschedule_event", [event, start, inHours(1203)]);
    const [s] = await rows<{ starts_at: Date; ends_at: Date }>(db.admin, "select starts_at, ends_at from event_shifts where id = $1", [sh.id]);
    expect(Math.abs(s.starts_at.getTime() - inHours(1203).getTime())).toBeLessThan(60_000);
    expect(Math.abs(s.ends_at.getTime() - (inHours(1203).getTime() + 45 * 60000))).toBeLessThan(60_000);
  });

  it("preview_reschedule shows exactly what reschedule_event then does (template + hand-made), and changes nothing itself", async () => {
    const v = await person(db);
    const start = inHours(1250), end = inHours(1252);
    const event = await makeEvent(db, { venue: mw, start, end });
    const [tmpl] = await rows<{ id: string }>(db.admin,
      "insert into duty_templates (code, name, event_type) values ('TPREV', 'Preview', 'fixture') returning id");
    const [item] = await rows<{ id: string }>(db.admin,
      `insert into duty_template_items (template_id, duty_type_id, start_anchor, start_offset_minutes, end_anchor, end_offset_minutes)
       values ($1, (select id from duty_types where code = 'cleaning'), 'event_end', 0, 'event_end', 30) returning id`, [tmpl.id]);
    await db.admin.query(`insert into event_shifts (event_id, duty_type_id, starts_at, ends_at, required_count, source_template_item_id)
       values ($1, (select id from duty_types where code = 'cleaning'), $2, $3, 1, $4)`, [event, end, new Date(end.getTime() + 30 * 60000), item.id]);
    const hand = await makeShift(db, { event, duty: "pitch_setup", start: inHours(1249), end: start });
    await rpc(db, v, "self_signup", [hand]);
    const [ns, ne] = [inHours(1273), inHours(1276)];   // a day later, and an hour longer
    type P = { shift_id: string; new_starts_at: Date; new_ends_at: Date; from_template: boolean; people_to_reconfirm: number };
    const preview = await db.asUser(coordMW.uid, (c) => rows<P>(c, "select * from public.preview_reschedule($1, $2, $3)", [event, ns, ne]));
    expect(preview).toHaveLength(2);
    expect(preview.find((p) => p.shift_id === hand)).toMatchObject({ from_template: false, people_to_reconfirm: 1 });
    const [unchanged] = await rows<{ starts_at: Date }>(db.admin, "select starts_at from events where id = $1", [event]);
    expect(unchanged.starts_at.getTime()).toBe(start.getTime());                       // preview saved nothing
    await rpc(db, coordMW, "reschedule_event", [event, ns, ne]);
    const after = await rows<{ id: string; starts_at: Date; ends_at: Date }>(db.admin, "select id, starts_at, ends_at from event_shifts where event_id = $1", [event]);
    for (const p of preview) {
      const a = after.find((x) => x.id === p.shift_id)!;
      expect([a.starts_at.getTime(), a.ends_at.getTime()]).toEqual([new Date(p.new_starts_at).getTime(), new Date(p.new_ends_at).getTime()]);
    }
    // Other venue's coordinator, or a volunteer, sees nothing.
    expect(await db.asUser(v.uid, (c) => rows(c, "select * from public.preview_reschedule($1, $2, $3)", [event, ns, ne]))).toEqual([]);
  });

  it("update_shift: lowering headcount below committed volunteers is refused; a time change resets", async () => {
    const [v, w] = [await person(db), await person(db)];
    const { shift } = await openShift({ required: 2, startH: 1300 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    await rpc(db, w, "self_signup", [shift]);
    await expectCode(rpc(db, coordMW, "update_shift", [shift, inHours(1300), inHours(1302), 1, null, null]), "below_committed");
    await rpc(db, coordMW, "update_shift", [shift, inHours(1300), inHours(1302), 3, null, null]); // raise: fine
    await rpc(db, coordMW, "update_shift", [shift, inHours(1301), inHours(1303), 3, null, null]); // time change
    expect(await statusOf(db, a.assignment_id)).toBe("invited");
  });
});

describe("status transitions are enforced centrally", () => {
  it.each([
    ["cancelled", "confirmed"],
    ["confirmed", "pending_approval"],
    ["confirmed", "declined"],
    ["declined", "withdrawn"],
  ])("%s → %s is rejected even for a superuser write", async (from, to) => {
    const v = await person(db);
    const { shift } = await openShift({ startH: 1400 + Math.floor(Math.random() * 500) });
    const id = await seedAssignment(db, shift, v.id, from === "cancelled" || from === "declined" ? "confirmed" : from);
    if (from === "cancelled") await db.admin.query("update assignments set status = 'cancelled' where id = $1", [id]);
    if (from === "declined") {
      await db.admin.query("update assignments set status = 'invited' where id = $1", [id]);
      await db.admin.query("update assignments set status = 'declined' where id = $1", [id]);
    }
    await expect(db.admin.query("update assignments set status = $2 where id = $1", [id, to])).rejects.toThrow(/invalid_transition/);
  });

  it("new assignments cannot start in a finished state; cannot move to another person", async () => {
    const [v, w] = [await person(db), await person(db)];
    const { shift } = await openShift({ startH: 2000 });
    await expect(seedAssignment(db, shift, v.id, "withdrawn")).rejects.toThrow(/invalid_transition/);
    const id = await seedAssignment(db, shift, v.id, "confirmed");
    await expect(db.admin.query("update assignments set volunteer_id = $2 where id = $1", [id, w.id])).rejects.toThrow(/assignment_immutable/);
  });
});

describe("attendance and completion", () => {
  it("attendance only for confirmed volunteers once the duty has started; complete after the end", async () => {
    const v = await person(db);
    const event = await makeEvent(db, { venue: mw, start: inHours(-3), end: inHours(-1) });
    const shift = await makeShift(db, { event, duty: "cleaning", start: inHours(-3), end: inHours(-1) });
    const id = await seedAssignment(db, shift, v.id, "confirmed");
    await expectCode(rpc(db, v, "mark_attendance", [id, "present"]), "not_authorised");
    expect((await rpc<{ attendance: string }>(db, coordMW, "mark_attendance", [id, "present"])).attendance).toBe("present");
    expect((await rpc<{ status: string }>(db, coordMW, "complete_event", [event])).status).toBe("completed");
    const { event: future } = await openShift({ startH: 2100 });
    await expectCode(rpc(db, coordMW, "complete_event", [future]), "event_not_finished");
  });
});

describe("access administration", () => {
  it("only admins change roles; the last active admin cannot be removed or demoted", async () => {
    const v = await person(db);
    await expectCode(rpc(db, v, "admin_set_volunteer_access", [v.id, "admin", true]), "not_authorised");
    await expectCode(rpc(db, coordMW, "admin_set_volunteer_access", [v.id, "admin", true]), "not_authorised");

    // Isolated world with exactly one admin.
    const solo = await createTestDb();
    try {
      const only = await person(solo, "admin");
      await expectCode(rpc(solo, only, "admin_set_volunteer_access", [only.id, "volunteer", true]), "last_admin");
      await expectCode(rpc(solo, only, "admin_set_volunteer_access", [only.id, "admin", false]), "last_admin");
      const second = await person(solo, "volunteer");
      await rpc(solo, only, "admin_set_volunteer_access", [second.id, "admin", true]);
      expect((await rpc<{ role: string }>(solo, only, "admin_set_volunteer_access", [only.id, "volunteer", true])).role).toBe("volunteer");
    } finally {
      await solo.drop();
    }
  });

  it("every assignment change is audited without contact details", async () => {
    const v = await person(db);
    const { shift } = await openShift({ startH: 2200 });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [shift]);
    const log = await rows<{ actor_volunteer_id: string; action: string; new_data: Record<string, unknown> }>(
      db.admin, "select actor_volunteer_id, action, new_data from audit_log where entity_type = 'assignments' and entity_id = $1", [a.assignment_id]);
    expect(log[0]).toMatchObject({ actor_volunteer_id: v.id, action: "insert" });
    const volAudit = await rows<{ new_data: Record<string, unknown> }>(db.admin,
      "select new_data from audit_log where entity_type = 'volunteers' and new_data is not null limit 5");
    for (const r of volAudit) {
      expect(r.new_data).not.toHaveProperty("email");
      expect(r.new_data).not.toHaveProperty("phone");
    }
  });
});
