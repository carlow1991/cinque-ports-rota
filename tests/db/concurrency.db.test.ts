import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createTestDb, rows, type TestDb } from "./harness";
import { inHours, makeCoordinator, makeEvent, makeShift, person, rpc, venueId, type Person } from "./fixtures";

/**
 * Real concurrency: each actor gets its OWN connection and transaction, as two phones would.
 * "Interleaved" tests force the race deterministically: A takes its locks and pauses
 * before committing while B starts; B must block and then see A's committed result.
 */
let db: TestDb;
let mw: string, fw: string;
let coord: Person;

beforeAll(async () => {
  db = await createTestDb();
  mw = await venueId(db, "marke_wood");
  fw = await venueId(db, "freemens_way");
  coord = await makeCoordinator(db, [mw, fw]);
});
afterAll(async () => db?.drop());

async function openTx(who: Person): Promise<Client> {
  const c = await db.connect();
  await c.query("begin");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.uid, role: "authenticated" })]);
  await c.query("set local role authenticated");
  return c;
}

async function settle(c: Client, p: Promise<unknown>): Promise<{ ok: boolean; code?: string }> {
  try {
    await p;
    await c.query("commit");
    return { ok: true };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, code: (e as Error).message };
  } finally {
    await c.end();
  }
}

/** Resolves true if the promise is still pending after ms (i.e. it is blocked on a lock). */
const stillPending = (p: Promise<unknown>, ms = 300) =>
  Promise.race([p.then(() => false, () => false), new Promise<boolean>((r) => setTimeout(() => r(true), ms))]);

async function lastSpot(required = 1, startH = 100) {
  const event = await makeEvent(db, { venue: mw, start: inHours(startH), end: inHours(startH + 2) });
  return makeShift(db, { event, duty: "cleaning", start: inHours(startH), end: inHours(startH + 2), required });
}

/** The shift's stored times, so a capacity-only update is not mistaken for a time change. */
const timesOf = async (shift: string) =>
  (await rows<{ starts_at: Date; ends_at: Date }>(db.admin, "select starts_at, ends_at from event_shifts where id = $1", [shift]))[0];

const confirmedOn = async (shift: string) =>
  (await rows<{ n: number }>(db.admin, "select count(*)::int as n from assignments where shift_id = $1 and status in ('confirmed','pending_approval')", [shift]))[0].n;

describe("last place, two people at the same moment", () => {
  it("interleaved: B waits for A's lock, then gets shift_full", async () => {
    const [a, b] = [await person(db), await person(db)];
    const shift = await lastSpot(1, 100);
    const ca = await openTx(a);
    await ca.query("select public.self_signup($1)", [shift]);   // A holds the shift lock, not yet committed
    const cb = await openTx(b);
    const pb = cb.query("select public.self_signup($1)", [shift]);
    expect(await stillPending(pb)).toBe(true);                   // B is genuinely blocked
    await ca.query("commit"); await ca.end();
    const rb = await settle(cb, pb);
    expect(rb).toEqual({ ok: false, code: "shift_full" });
    expect(await confirmedOn(shift)).toBe(1);
  });

  it("burst: 12 volunteers race for 3 places → exactly 3 succeed", async () => {
    const people = await Promise.all(Array.from({ length: 12 }, () => person(db)));
    const shift = await lastSpot(3, 110);
    const results = await Promise.all(people.map(async (p) => {
      const c = await openTx(p);
      return settle(c, c.query("select public.self_signup($1)", [shift]));
    }));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "shift_full")).toBe(true);
    expect(await confirmedOn(shift)).toBe(3);
  });

  it("two invitees accept the last place at once → exactly one succeeds", async () => {
    const [a, b] = [await person(db), await person(db)];
    const shift = await lastSpot(1, 120);
    const ia = await rpc<{ assignment_id: string }>(db, coord, "allocate_volunteer", [shift, a.id]);
    const ib = await rpc<{ assignment_id: string }>(db, coord, "allocate_volunteer", [shift, b.id]);
    const [ra, rb] = await Promise.all([
      (async () => { const c = await openTx(a); return settle(c, c.query("select public.accept_invitation($1)", [ia.assignment_id])); })(),
      (async () => { const c = await openTx(b); return settle(c, c.query("select public.accept_invitation($1)", [ib.assignment_id])); })(),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    expect([ra.code, rb.code]).toContain("shift_full");
    expect(await confirmedOn(shift)).toBe(1);
  });
});

describe("same person, two tabs, overlapping duties", () => {
  it("interleaved across venues: second tab blocks on the volunteer lock, then gets overlap", async () => {
    const v = await person(db);
    const e1 = await makeEvent(db, { venue: mw, start: inHours(200), end: inHours(203) });
    const e2 = await makeEvent(db, { venue: fw, start: inHours(201), end: inHours(204) });
    const s1 = await makeShift(db, { event: e1, duty: "cleaning", start: inHours(200), end: inHours(203), required: 5 });
    const s2 = await makeShift(db, { event: e2, duty: "cleaning", start: inHours(201), end: inHours(204), required: 5 });
    const tab1 = await openTx(v);
    await tab1.query("select public.self_signup($1)", [s1]);
    const tab2 = await openTx(v);
    const p2 = tab2.query("select public.self_signup($1)", [s2]);
    expect(await stillPending(p2)).toBe(true);
    await tab1.query("commit"); await tab1.end();
    expect(await settle(tab2, p2)).toEqual({ ok: false, code: "overlap" });
  });

  it("burst: 6 overlapping duties attempted at once → exactly one", async () => {
    const v = await person(db);
    const shifts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await makeEvent(db, { venue: i % 2 ? mw : fw, start: inHours(300 + i * 0.25), end: inHours(302 + i * 0.25) });
      shifts.push(await makeShift(db, { event: e, duty: "cleaning", start: inHours(300 + i * 0.25), end: inHours(302 + i * 0.25), required: 5 }));
    }
    const results = await Promise.all(shifts.map(async (s) => { const c = await openTx(v); return settle(c, c.query("select public.self_signup($1)", [s])); }));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => r.code === "overlap")).toBe(true);
  });
});

describe("organiser changes capacity during sign-up", () => {
  it("sign-up first, then lowering capacity → below_committed (no one silently dropped)", async () => {
    const [x, y] = [await person(db), await person(db)];
    const shift = await lastSpot(2, 400);
    await rpc(db, x, "self_signup", [shift]);
    const cy = await openTx(y);
    await cy.query("select public.self_signup($1)", [shift]);           // takes the 2nd place, uncommitted
    const cc = await openTx(coord);
    const t = await timesOf(shift);
    const pc = cc.query("select public.update_shift($1, $2, $3, 1, null, null)", [shift, t.starts_at, t.ends_at]);
    expect(await stillPending(pc)).toBe(true);
    await cy.query("commit"); await cy.end();
    expect(await settle(cc, pc)).toEqual({ ok: false, code: "below_committed" });
    expect(await confirmedOn(shift)).toBe(2);
  });

  it("capacity lowered first, then sign-up → shift_full (no overbooking)", async () => {
    const [x, y] = [await person(db), await person(db)];
    const shift = await lastSpot(2, 410);
    await rpc(db, x, "self_signup", [shift]);
    const cc = await openTx(coord);
    const t = await timesOf(shift);
    const r = await cc.query("select public.update_shift($1, $2, $3, 1, null, null) as r", [shift, t.starts_at, t.ends_at]);
    expect(r.rows[0].r.assignments_reset).toBe(0); // capacity change only: nobody asked to reconfirm
    const cy = await openTx(y);
    const py = cy.query("select public.self_signup($1)", [shift]);
    expect(await stillPending(py)).toBe(true);
    await cc.query("commit"); await cc.end();
    expect(await settle(cy, py)).toEqual({ ok: false, code: "shift_full" });
    expect(await confirmedOn(shift)).toBe(1);
  });

  it("event cancelled while a sign-up is in flight → the new sign-up is cancelled too", async () => {
    const v = await person(db);
    const event = await makeEvent(db, { venue: mw, start: inHours(420), end: inHours(422) });
    const shift = await makeShift(db, { event, duty: "cleaning", start: inHours(420), end: inHours(422), required: 3 });
    const cv = await openTx(v);
    await cv.query("select public.self_signup($1)", [shift]);
    const cc = await openTx(coord);
    const pc = cc.query("select public.cancel_event($1, 'Storm')", [event]);
    expect(await stillPending(pc)).toBe(true);
    await cv.query("commit"); await cv.end();
    expect((await settle(cc, pc)).ok).toBe(true);
    const [r] = await rows<{ status: string }>(db.admin, "select status from assignments where shift_id = $1", [shift]);
    expect(r.status).toBe("cancelled");
  });
});
