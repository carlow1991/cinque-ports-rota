import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, rows, type TestDb } from "./harness";
import { expectCode, inHours, makeCoordinator, makeEvent, makeShift, person, rpc, venueId, type Person } from "./fixtures";

let db: TestDb;
let mw: string;
let admin: Person, coord: Person;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  admin = await person(db, "admin");
  coord = await makeCoordinator(db, [mw]);
  // These worker tests assume email has been started (increment 6 release switch); the gate itself
  // is tested in its own block below.
  await db.admin.query("update club_settings set email_released_from = '-infinity' where id = 1");
});
afterAll(async () => db?.drop());

type Claimed = { id: string; kind: string; dedupe_key: string; payload: Record<string, unknown>; attempt_count: number; recipient_email: string; recipient_name: string };
const claim = (n = 25) => db.asService((c) => rows<Claimed>(c, "select * from public.outbox_claim($1)", [n]));
const complete = (id: string, ok: boolean, err: string | null = null, retryable = true) =>
  db.asService(async (c) => (await c.query("select public.outbox_complete($1, $2, $3, null, $4) as s", [id, ok, err, retryable])).rows[0].s as string);
const statusOf = async (id: string) => (await rows<{ status: string; attempt_count: number; error: string | null; send_after: Date }>(db.admin, "select status, attempt_count, error, send_after from notification_outbox where id = $1", [id]))[0];
/** Clear the queue between tests so each one sees only its own messages. */
const drain = () => db.admin.query("update notification_outbox set status = 'sent' where status in ('pending', 'sending')");

async function signUpFor(startH: number, opts: { demo?: boolean } = {}) {
  const v = await person(db);
  const e = await makeEvent(db, { venue: mw, start: inHours(startH), end: inHours(startH + 2), isDemo: opts.demo });
  const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(startH), end: inHours(startH + 2), required: 5 });
  const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [s]);
  return { v, e, s, a: a.assignment_id };
}

describe("who can use the outbox", () => {
  it("app users (even admins) can't read the outbox or call worker functions; anon can't either", async () => {
    await expect(db.asUser(admin.uid, (c) => c.query("select * from notification_outbox"))).rejects.toThrow(/permission denied/);
    for (const sql of ["select * from public.outbox_claim(1)", "select public.outbox_enqueue_reminders()", "select public.outbox_suppress(gen_random_uuid(), 'x')"]) {
      await expect(db.asUser(admin.uid, (c) => c.query(sql))).rejects.toThrow(/permission denied/);
      await expect(db.asAnon((c) => c.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
  it("only admins see the redacted summary and can retry; it contains no addresses", async () => {
    await signUpFor(400);
    const s = await db.asUser(admin.uid, (c) => rows(c, "select * from public.admin_outbox_summary()"));
    expect(s.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/@/);
    expect(await db.asUser(coord.uid, (c) => rows(c, "select * from public.admin_outbox_summary()"))).toEqual([]);
    await expectCode(rpc(db, coord, "admin_retry_failed_emails"), "not_authorised");
  });
});

describe("claiming and completing", () => {
  it("each message is handed to exactly one worker, even when two claim at once", async () => {
    await drain();
    for (let i = 0; i < 6; i++) await signUpFor(500 + i * 3);
    const [a, b] = await Promise.all([claim(4), claim(4)]);
    const ids = [...a, ...b].map((x) => x.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
    expect((await claim(10)).length).toBe(0); // all now 'sending'
    for (const id of ids) await complete(id, true);
  });

  it("claims carry the recipient's address for sending, and the payload has only their own duty", async () => {
    await drain();
    const { v } = await signUpFor(600);
    const [m] = await claim(5);
    expect(m.recipient_email).toBe(v.email);
    expect(m.kind).toBe("signup_confirmed");
    expect(Object.keys(m.payload).sort()).toEqual(["assignment_id", "demo", "duty", "event_id", "event_status_reason", "event_title", "removal_reason", "shift_ends_at", "shift_starts_at", "status", "venue"].sort());
    await complete(m.id, true);
  });

  it("a sent message is never handed out again (retries can't duplicate)", async () => {
    await drain();
    await signUpFor(700);
    const [m] = await claim();
    expect(await complete(m.id, true)).toBe("sent");
    expect(await complete(m.id, false, "late duplicate callback")).toBe("sent"); // ignored
    expect((await claim()).map((x) => x.id)).not.toContain(m.id);
  });

  it("failures retry with backoff (2, 4, 8, 16 min) then stop at 5 attempts; errors never keep addresses", async () => {
    await drain();
    const { v } = await signUpFor(800);
    let [m] = await claim();
    expect(await complete(m.id, false, `rejected ${v.email} 503`)).toBe("pending");
    let s = await statusOf(m.id);
    expect(s.error).toBe("rejected [email] 503");
    expect(Math.round((s.send_after.getTime() - Date.now()) / 60000)).toBe(2);
    for (let attempt = 2; attempt <= 5; attempt++) {
      await db.admin.query("update notification_outbox set send_after = now() where id = $1", [m.id]);
      [m] = (await claim()).filter((x) => x.id === m.id);
      expect(m.attempt_count).toBe(attempt);
      const r = await complete(m.id, false, "503");
      expect(r).toBe(attempt < 5 ? "pending" : "failed");
    }
    s = await statusOf(m.id);
    expect(s).toMatchObject({ status: "failed", attempt_count: 5 });
    // An admin can put recent failures back in the queue.
    expect(await rpc<number>(db, admin, "admin_retry_failed_emails")).toBeGreaterThanOrEqual(1);
    expect((await statusOf(m.id)).status).toBe("pending");
  });

  it("a permanent error fails at once", async () => {
    await drain();
    await signUpFor(900);
    const [m] = await claim();
    expect(await complete(m.id, false, "invalid recipient", false)).toBe("failed");
  });

  it("messages stuck in 'sending' after a crash go back to the queue after 10 minutes", async () => {
    await drain();
    await signUpFor(1000);
    const [m] = await claim();
    await db.admin.query("update notification_outbox set claimed_at = now() - interval '11 minutes' where id = $1", [m.id]);
    const again = await claim();
    expect(again.map((x) => x.id)).toContain(m.id);
    await complete(m.id, true);
  });
});

describe("never sending what shouldn't be sent", () => {
  it("demo events are suppressed at creation and never claimed", async () => {
    await drain();
    const { a } = await signUpFor(1100, { demo: true });
    const [o] = await rows<{ status: string }>(db.admin, "select status from notification_outbox where entity_id = $1", [a]);
    expect(o.status).toBe("suppressed");
    expect((await claim()).length).toBe(0);
  });

  it("messages to a suspended volunteer are suppressed at send time", async () => {
    await drain();
    const { v, a } = await signUpFor(1200);
    await rpc(db, admin, "admin_set_volunteer_access", [v.id, "volunteer", false]);
    expect((await claim()).length).toBe(0);
    const [o] = await rows<{ status: string; error: string }>(db.admin, "select status, error from notification_outbox where entity_id = $1", [a]);
    expect(o).toEqual({ status: "suppressed", error: "recipient_inactive" });
  });

  it("the suppress function (staging allow-list) stops a claimed message", async () => {
    await drain();
    await signUpFor(1300);
    const [m] = await claim();
    await db.asService((c) => c.query("select public.outbox_suppress($1, 'not_allowlisted')", [m.id]));
    expect((await statusOf(m.id)).status).toBe("suppressed");
  });
});

describe("day-before reminders (UK time)", () => {
  const enqueue = (now: Date) => db.asService(async (c) => (await c.query("select public.outbox_enqueue_reminders($1) as n", [now])).rows[0].n as number);
  const reminders = (a: string) => rows<{ dedupe_key: string; send_after: Date; status: string }>(db.admin, "select dedupe_key, send_after, status from notification_outbox where kind = 'reminder' and entity_id = $1", [a]);

  async function dutyAt(startIso: string) {
    const v = await person(db);
    const start = new Date(startIso);
    const end = new Date(start.getTime() + 2 * 3600_000);
    const e = await makeEvent(db, { venue: mw, start, end });
    const s = await makeShift(db, { event: e, duty: "cleaning", start, end, required: 3 });
    // Arrange directly (the duty date is fixed in the future for the test).
    const [a] = await rows<{ id: string }>(db.admin, "insert into assignments (shift_id, volunteer_id, status, source) values ($1, $2, 'confirmed', 'self_signup') returning id", [s, v.id]);
    return { a: a.id, e, s };
  }

  it("enqueued the day before by UK date, due at 18:00 UK; re-running never duplicates", async () => {
    const { a } = await dutyAt("2030-07-13T09:00:00Z"); // Sat 13 Jul 2030, 10:00 BST
    expect(await enqueue(new Date("2030-07-11T20:00:00Z"))).toBe(0);  // two days before: nothing
    expect(await enqueue(new Date("2030-07-12T06:00:00Z"))).toBeGreaterThanOrEqual(1);
    await enqueue(new Date("2030-07-12T07:00:00Z"));
    const r = await reminders(a);
    expect(r).toHaveLength(1);
    expect(r[0].dedupe_key).toBe(`reminder:${a}:2030-07-13`);
    expect(r[0].send_after.toISOString()).toBe("2030-07-12T17:00:00.000Z"); // 18:00 BST
  });

  it("uses the UK date, not the UTC date, around midnight and across the clock change", async () => {
    // 00:30 BST on Sun 27 Oct 2030 is 23:30 UTC on Sat 26 Oct: the UK date is the 27th.
    const { a } = await dutyAt("2030-10-26T23:30:00Z");
    await enqueue(new Date("2030-10-25T12:00:00Z")); // Fri: UK "tomorrow" is Sat 26th → not this duty
    expect(await reminders(a)).toHaveLength(0);
    await enqueue(new Date("2030-10-26T12:00:00Z")); // Sat 26th: UK tomorrow is Sun 27th (clocks go back)
    const r = await reminders(a);
    expect(r).toHaveLength(1);
    expect(r[0].dedupe_key.endsWith(":2030-10-27")).toBe(true);
    expect(r[0].send_after.toISOString()).toBe("2030-10-26T17:00:00.000Z"); // 18:00 BST on the 26th
  });

  it("a reminder is suppressed at send time if the duty was cancelled after it was queued", async () => {
    await drain();
    const v = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(20), end: inHours(22) });
    const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(20), end: inHours(22) });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [s]);
    await drain();
    await db.admin.query(
      `insert into notification_outbox (recipient_volunteer_id, kind, entity_type, entity_id, dedupe_key, payload, send_after)
       values ($1, 'reminder', 'assignments', $2, $3, '{}', now() - interval '1 minute')`, [v.id, a.assignment_id, `reminder:${a.assignment_id}:test`]);
    await db.admin.query("update assignments set status = 'withdrawn' where id = $1", [a.assignment_id]);
    expect((await claim()).filter((x) => x.kind === "reminder")).toHaveLength(0);
    const [o] = await rows<{ status: string; error: string }>(db.admin, "select status, error from notification_outbox where dedupe_key = $1", [`reminder:${a.assignment_id}:test`]);
    expect(o).toEqual({ status: "suppressed", error: "duty_no_longer_active" });
  });

  it("switching reminders off in settings stops new ones", async () => {
    const { a } = await dutyAt("2031-02-08T10:00:00Z");
    await db.admin.query("update club_settings set reminder_day_before = false");
    expect(await enqueue(new Date("2031-02-07T09:00:00Z"))).toBe(0);
    await db.admin.query("update club_settings set reminder_day_before = true");
    expect(await reminders(a)).toHaveLength(0);
  });
});

describe("release switch (nothing goes until an administrator starts email)", () => {
  const setRelease = (v: string | null) => db.admin.query("update club_settings set email_released_from = $1 where id = 1", [v]);
  const pendingFor = async (a: string) => (await rows<{ id: string; status: string; error: string | null }>(db.admin,
    "select id, status, error from notification_outbox where entity_id = $1 order by created_at", [a]));

  it("while held, the worker hands out nothing and queues no reminders, even though messages are waiting", async () => {
    await drain();
    await setRelease(null);
    const { a } = await signUpFor(700);
    expect((await pendingFor(a))[0].status).toBe("pending");
    expect(await claim(10)).toEqual([]);
    expect(await db.asService(async (c) => (await c.query("select public.outbox_enqueue_reminders() as n")).rows[0].n)).toBe(0);
  });

  it("only an admin can start or pause; the backlog preview has counts only, no addresses", async () => {
    await setRelease(null);
    await expectCode(rpc(db, coord, "admin_set_email_release", ["new_only"]), "not_authorised");
    expect(await db.asUser(coord.uid, (c) => rows(c, "select * from public.admin_email_backlog()"))).toEqual([]);
    const b = await db.asUser(admin.uid, (c) => rows<{ kind: string; held: number; still_current: number }>(c, "select * from public.admin_email_backlog()"));
    expect(b.find((x) => x.kind === "signup_confirmed")!.held).toBeGreaterThan(0);
    expect(JSON.stringify(b)).not.toMatch(/@/);
  });

  it("'new emails only' holds back the old queue for good; new messages after it go", async () => {
    await drain();
    await setRelease(null);
    const old = await signUpFor(710);
    await rpc(db, admin, "admin_set_email_release", ["new_only"]);
    expect((await pendingFor(old.a))[0]).toMatchObject({ status: "suppressed", error: "held_before_release" });
    const fresh = await signUpFor(720);
    const got = await claim(10);
    expect(got.map((x) => x.payload.assignment_id)).toEqual([fresh.a]);
    for (const g of got) await complete(g.id, true);
  });

  it("'include still-current' sends queued messages that are still true and drops out-of-date ones", async () => {
    await drain();
    await setRelease(null);
    const keep = await signUpFor(730);
    const gone = await signUpFor(740);
    await rpc(db, gone.v, "withdraw_assignment", [gone.a]);              // its 'confirmed' email is now out of date
    const r = await rpc<{ suppressed_out_of_date: number }>(db, admin, "admin_set_email_release", ["include_current"]);
    expect(r.suppressed_out_of_date).toBeGreaterThanOrEqual(1);
    const got = await claim(10);
    const kinds = got.map((x) => `${x.kind}:${x.payload.assignment_id}`).sort();
    expect(kinds).toEqual([`signup_confirmed:${keep.a}`, `withdrawal_confirmed:${gone.a}`].sort());
    for (const g of got) await complete(g.id, true);
  });

  it("pause stops sending again; turning the hosting switch on alone never releases anything", async () => {
    await rpc(db, admin, "admin_set_email_release", ["pause"]);
    await signUpFor(750);
    expect(await claim(10)).toEqual([]);
    await setRelease("-infinity"); // restore for any later tests
  });
});

describe("re-checked just before sending (current state)", () => {
  it("an invitation that was declined, or superseded by a newer message, is not sent", async () => {
    await drain();
    const v = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(800), end: inHours(802) });
    const s1 = await makeShift(db, { event: e, duty: "cleaning", start: inHours(800), end: inHours(802) });
    const s2 = await makeShift(db, { event: e, duty: "refreshments", start: inHours(800), end: inHours(802) });
    const i1 = await rpc<{ assignment_id: string }>(db, coord, "allocate_volunteer", [s1, v.id]);
    await rpc(db, v, "decline_invitation", [i1.assignment_id]);            // invitation now out of date
    const i2 = await rpc<{ assignment_id: string }>(db, coord, "allocate_volunteer", [s2, v.id]);
    await rpc(db, v, "accept_invitation", [i2.assignment_id]);             // invitation superseded by 'accepted'
    const got = await claim(20);
    const sent = got.filter((x) => x.payload.assignment_id === i1.assignment_id || x.payload.assignment_id === i2.assignment_id).map((x) => x.kind).sort();
    expect(sent).not.toContain("duty_invitation");
    expect(sent).toContain("invitation_accepted");
    const why = await rows<{ error: string }>(db.admin, "select error from notification_outbox where kind = 'duty_invitation' and entity_id in ($1, $2)", [i1.assignment_id, i2.assignment_id]);
    expect(why).toHaveLength(2);
    expect(why.every((x) => ["status_changed", "superseded"].includes(x.error))).toBe(true);
    for (const g of got) await complete(g.id, true);
  });

  it("a cancellation-request alert to organisers is dropped once the request is resolved", async () => {
    await drain();
    const v = await person(db);
    const e = await makeEvent(db, { venue: mw, start: inHours(6), end: inHours(8) });
    const s = await makeShift(db, { event: e, duty: "cleaning", start: inHours(6), end: inHours(8) });
    const a = await rpc<{ assignment_id: string }>(db, v, "self_signup", [s]);
    const req = await rpc<{ request_id: string }>(db, v, "request_cancellation", [a.assignment_id, "Away"]);
    await rpc(db, coord, "resolve_cancellation_request", [req.request_id, false]);
    const got = await claim(20);
    expect(got.some((x) => x.kind === "cancellation_requested")).toBe(false);
    const [r] = await rows<{ error: string }>(db.admin, "select error from notification_outbox where kind = 'cancellation_requested' and entity_id = $1 limit 1", [req.request_id]);
    expect(r.error).toBe("request_resolved");
    for (const g of got) await complete(g.id, true);
  });
});
