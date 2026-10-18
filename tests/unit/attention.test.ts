import { describe, expect, it } from "vitest";
import { buildAttention, parseRange, type AttEvent, type AttQueue, type AttShift } from "@/lib/domain/attention";

const now = new Date("2026-10-18T09:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();
const from = now, to = new Date(now.getTime() + 28 * 86_400_000);
const fmt = (a: Date, b: Date) => `${a.toISOString().slice(11, 16)}–${b.toISOString().slice(11, 16)}`;

const ev = (o: Partial<AttEvent> & { event_id: string }): AttEvent => ({
  title: o.event_id, status: "published", venue_name: "Marke Wood", starts_at: h(100), ends_at: h(102),
  coverage_event_id: null, cover_state: "covered_by_volunteer", ...o,
});
const sh = (o: Partial<AttShift> & { shift_id: string; event_id: string }): AttShift => ({
  event_title: o.event_id, venue_name: "Marke Wood", duty_code: "cleaning", duty_name: "Cleaning",
  starts_at: h(100), ends_at: h(101), required: 2, confirmed: 1, pending: 0, open: 1, ...o,
});
const qu = (o: Partial<AttQueue> & { kind: AttQueue["kind"]; assignment_id: string }): AttQueue => ({
  request_id: null, event_id: "e", event_title: "E", venue_name: "Marke Wood", duty_name: "Gate",
  shift_starts_at: h(50), shift_ends_at: h(51), display_name: "Pat", reason: null, ...o,
});
const run = (p: Partial<Parameters<typeof buildAttention>[0]>) =>
  buildAttention({ events: [], shifts: [], queue: [], gaps: new Map(), from, to, now, formatRange: fmt, ...p });

describe("buildAttention", () => {
  it("orders: urgent (late cancel, imminent lead gap, imminent open place) → later lead gap → open → reconfirm → approval → invitation → draft", () => {
    const { items } = run({
      events: [
        ev({ event_id: "soon", starts_at: h(24), ends_at: h(26), cover_state: "no_cover" }),
        ev({ event_id: "later", starts_at: h(300), ends_at: h(302), cover_state: "at_risk" }),
        ev({ event_id: "ok" }),
        ev({ event_id: "draft1", status: "draft", starts_at: h(200), ends_at: h(202) }),
      ],
      shifts: [sh({ shift_id: "s-soon", event_id: "ok", starts_at: h(10), ends_at: h(11) }), sh({ shift_id: "s-later", event_id: "ok" })],
      queue: [
        qu({ kind: "invitation", assignment_id: "i" }), qu({ kind: "approval", assignment_id: "a" }),
        qu({ kind: "reconfirmation", assignment_id: "r" }), qu({ kind: "cancellation", assignment_id: "c", request_id: "rq", shift_starts_at: h(30), reason: "Ill" }),
      ],
    });
    expect(items.map((i) => i.key)).toEqual([
      "open-s-soon", "lead-soon", "cancel-rq", "lead-later", "open-s-later", "reconfirm-r", "approve-a", "invite-i", "draft-draft1",
    ]);
    expect(items.slice(0, 3).every((i) => i.tier === "urgent")).toBe(true);
  });

  it("lists exact gaps in the agreed wording and links a linked event to its venue cover", () => {
    const gaps = new Map([["x", [{ start: new Date(h(100)), end: new Date(h(101)) }]]]);
    const { items } = run({ events: [ev({ event_id: "x", cover_state: "at_risk", coverage_event_id: "cov" })], gaps });
    expect(items[0].reason).toBe(`No confirmed site lead · ${fmt(new Date(h(100)), new Date(h(101)))}`);
    expect(items[0].action).toEqual({ label: "Open venue cover", href: "/manage/events/cov" });
  });

  it("does not repeat an open site-lead duty already listed as a site-lead gap; ignores past, cancelled and fully staffed", () => {
    const { items } = run({
      events: [ev({ event_id: "x", cover_state: "no_cover" }), ev({ event_id: "gone", status: "cancelled", cover_state: "no_cover" }),
        ev({ event_id: "past", starts_at: h(-5), ends_at: h(-3), cover_state: "no_cover" })],
      shifts: [sh({ shift_id: "lead", event_id: "x", duty_code: "site_lead" }), sh({ shift_id: "full", event_id: "x", open: 0 }),
        sh({ shift_id: "c", event_id: "gone" })],
    });
    expect(items.map((i) => i.key)).toEqual(["lead-x"]);
  });

  it("requests outside the range are counted, not listed; late cancellations always listed", () => {
    const { items, laterRequests } = run({
      queue: [qu({ kind: "approval", assignment_id: "far", shift_starts_at: h(1000), shift_ends_at: h(1001) }),
        qu({ kind: "cancellation", assignment_id: "c", request_id: "rq", shift_starts_at: h(1000), shift_ends_at: h(1001) })],
    });
    expect(items.map((i) => i.key)).toEqual(["cancel-rq"]);
    expect(laterRequests).toBe(1);
  });

  it("an empty input gives an empty list (the page shows its own empty state, never 'all clear' by default)", () => {
    expect(run({}).items).toEqual([]);
  });
});

describe("parseRange", () => {
  it("defaults to 28 days and accepts only the presets", () => {
    expect(parseRange(undefined)).toBe("28");
    expect(parseRange("7")).toBe("7");
    expect(parseRange("today")).toBe("today");
    expect(parseRange("365")).toBe("28");
  });
});
