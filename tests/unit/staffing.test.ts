import { describe, expect, it } from "vitest";
import { expectedOnSite, staffingByShift, type RosterLike } from "@/lib/domain/staffing";

const base = { event_id: "e1", event_title: "Fixture", venue_id: "mw", venue_name: "Marke Wood", team_name: null };
const row = (o: Partial<RosterLike> & Pick<RosterLike, "shift_id">): RosterLike => ({
  ...base, duty_code: "cleaning", duty_name: "Post-event cleaning", shift_starts_at: "2026-10-24T14:00:00Z",
  shift_ends_at: "2026-10-24T15:00:00Z", required_count: 2, volunteer_id: null, display_name: null, status: null, ...o,
});

describe("staffingByShift", () => {
  it("a confirmed person with a pending cancellation request is still confirmed but counted at risk", () => {
    const s = staffingByShift([
      row({ shift_id: "s1", required_count: 2, volunteer_id: "a", display_name: "A", status: "confirmed", cancellation_request_id: "r1" }),
      row({ shift_id: "s1", required_count: 2, volunteer_id: "b", display_name: "B", status: "confirmed", cancellation_request_id: null }),
    ]);
    expect(s[0]).toMatchObject({ confirmed: 2, at_risk: 1, open: 0 });
  });

  it("counts confirmed, pending (holds a place) and invited (does not) separately", () => {
    const s = staffingByShift([
      row({ shift_id: "s1", volunteer_id: "a", display_name: "A", status: "confirmed" }),
      row({ shift_id: "s1", volunteer_id: "b", display_name: "B", status: "invited" }),
      row({ shift_id: "s2", required_count: 3, volunteer_id: "c", display_name: "C", status: "pending_approval" }),
      row({ shift_id: "s3", required_count: 1 }), // nobody yet
    ]);
    expect(s.map((x) => [x.shift_id, x.required, x.confirmed, x.pending, x.invited, x.open])).toEqual([
      ["s1", 2, 1, 0, 1, 1],
      ["s2", 3, 0, 1, 0, 2],
      ["s3", 1, 0, 0, 0, 1],
    ]);
  });
  it("a composite site-lead duty is ONE row and ONE place, however many responsibilities it has", () => {
    const s = staffingByShift([row({ shift_id: "lead", duty_code: "site_lead", required_count: 1, volunteer_id: "l", display_name: "L", status: "confirmed" })]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ required: 1, confirmed: 1, open: 0 });
  });
});

describe("expectedOnSite", () => {
  const day = [new Date("2026-10-24T08:00:00Z"), new Date("2026-10-24T20:00:00Z")] as const;
  it("counts unique confirmed people per slot; back-to-back duties by one person count once", () => {
    const rows = [
      row({ shift_id: "setup", shift_starts_at: "2026-10-24T13:00:00Z", shift_ends_at: "2026-10-24T14:00:00Z", volunteer_id: "a", display_name: "Ann", status: "confirmed" }),
      row({ shift_id: "clean", shift_starts_at: "2026-10-24T14:00:00Z", shift_ends_at: "2026-10-24T15:00:00Z", volunteer_id: "a", display_name: "Ann", status: "confirmed" }),
      row({ shift_id: "clean", shift_starts_at: "2026-10-24T14:00:00Z", shift_ends_at: "2026-10-24T15:00:00Z", volunteer_id: "b", display_name: "Ben", status: "confirmed" }),
      row({ shift_id: "clean", shift_starts_at: "2026-10-24T14:00:00Z", shift_ends_at: "2026-10-24T15:00:00Z", volunteer_id: "c", display_name: "Cat", status: "invited" }),
    ];
    const t = expectedOnSite(rows, "mw", ...day, 30);
    expect(t.map((s) => [s.start.toISOString().slice(11, 16), s.expected])).toEqual([["13:00", 1], ["13:30", 1], ["14:00", 2], ["14:30", 2]]);
    expect(t[2].names).toEqual(["Ann", "Ben"]);
  });
  it("ignores other venues and unconfirmed people; empty when nobody is confirmed", () => {
    expect(expectedOnSite([row({ shift_id: "x", volunteer_id: "z", status: "pending_approval" })], "mw", ...day)).toEqual([]);
    expect(expectedOnSite([row({ shift_id: "x", venue_id: "fw", volunteer_id: "z", status: "confirmed" })], "mw", ...day)).toEqual([]);
  });
});
