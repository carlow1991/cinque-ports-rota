import { describe, expect, it } from "vitest";
import {
  addDays, formatRange, formatTime, londonParts, londonToInstant, londonWindow, startOfLondonDay, startOfWeek, zoneLabel,
} from "@/lib/time/london";

const iso = (d: Date) => d.toISOString();

describe("UK wall time → instant", () => {
  it("winter (GMT = UTC)", () => {
    const r = londonToInstant("2026-01-17", "15:00");
    expect(r.ok && iso(r.instant)).toBe("2026-01-17T15:00:00.000Z");
  });
  it("summer (BST = UTC+1)", () => {
    const r = londonToInstant("2026-08-15", "15:00");
    expect(r.ok && iso(r.instant)).toBe("2026-08-15T14:00:00.000Z");
  });
  it("spring forward: 01:30 on 29 Mar 2026 does not exist", () => {
    expect(londonToInstant("2026-03-29", "01:30")).toEqual({ ok: false, reason: "nonexistent" });
    const before = londonToInstant("2026-03-29", "00:59");
    const after = londonToInstant("2026-03-29", "02:00");
    expect(before.ok && iso(before.instant)).toBe("2026-03-29T00:59:00.000Z");
    expect(after.ok && iso(after.instant)).toBe("2026-03-29T01:00:00.000Z"); // 02:00 BST
  });
  it("fall back: 01:30 on 25 Oct 2026 happens twice → first (BST) occurrence, flagged ambiguous", () => {
    const r = londonToInstant("2026-10-25", "01:30");
    expect(r).toMatchObject({ ok: true, ambiguous: true });
    expect(r.ok && iso(r.instant)).toBe("2026-10-25T00:30:00.000Z");
    const later = londonToInstant("2026-10-25", "02:30");
    expect(later).toMatchObject({ ok: true, ambiguous: false });
    expect(later.ok && iso(later.instant)).toBe("2026-10-25T02:30:00.000Z"); // GMT again
  });
  it("2027 clock changes (28 Mar, 31 Oct)", () => {
    expect(londonToInstant("2027-03-28", "01:15")).toEqual({ ok: false, reason: "nonexistent" });
    expect(londonToInstant("2027-10-31", "01:15")).toMatchObject({ ok: true, ambiguous: true });
  });
  it("rejects malformed input", () => {
    for (const [d, t] of [["2026-02-30", "10:00"], ["2026-13-01", "10:00"], ["2026-01-01", "24:00"], ["2026-01-01", "9:00"], ["x", "10:00"]]) {
      expect(londonToInstant(d, t)).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("round-trips every quarter hour of both 2026 clock-change days", () => {
    for (const day of ["2026-03-29", "2026-10-25"]) {
      for (let m = 0; m < 24 * 60; m += 15) {
        const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        const r = londonToInstant(day, t);
        if (r.ok) {
          const p = londonParts(r.instant);
          expect(`${p.dateKey} ${p.time}`).toBe(`${day} ${t}`);
        } else {
          expect(day).toBe("2026-03-29");
          expect(t >= "01:00" && t < "02:00").toBe(true);
        }
      }
    }
  });
});

describe("event windows", () => {
  it("normal afternoon fixture", () => {
    const w = londonWindow("2026-09-05", "15:00", "16:45");
    expect(w).toMatchObject({ ok: true, crossesMidnight: false });
    expect(w.ok && [iso(w.startsAt), iso(w.endsAt)]).toEqual(["2026-09-05T14:00:00.000Z", "2026-09-05T15:45:00.000Z"]);
  });
  it("end before start = runs past midnight", () => {
    const w = londonWindow("2026-12-31", "20:00", "01:00");
    expect(w).toMatchObject({ ok: true, crossesMidnight: true });
    expect(w.ok && iso(w.endsAt)).toBe("2027-01-01T01:00:00.000Z");
  });
  it("an evening event across the autumn clock change lasts the real elapsed time", () => {
    // Sat 24 Oct 22:00 BST → Sun 25 Oct 02:00 GMT = 5 real hours.
    const w = londonWindow("2026-10-24", "22:00", "02:00");
    expect(w.ok && (w.endsAt.getTime() - w.startsAt.getTime()) / 3600_000).toBe(5);
  });
  it("explains a start inside the spring-forward gap", () => {
    const w = londonWindow("2026-03-29", "01:30", "03:00");
    expect(w.ok).toBe(false);
    expect(!w.ok && w.error).toMatch(/clocks go forward/);
  });
  it("rejects > 24 hours and equal times", () => {
    expect(londonWindow("2026-05-01", "10:00", "10:00").ok).toBe(true); // 24h exactly via next day
    expect(londonWindow("2026-10-24", "10:00", "10:00").ok).toBe(false); // 25h across fall-back
  });
});

describe("display", () => {
  it("formats in UK time with the right zone label", () => {
    expect(formatTime(new Date("2026-07-04T13:00:00Z"))).toBe("14:00");
    expect(zoneLabel(new Date("2026-07-04T13:00:00Z"))).toBe("BST");
    expect(zoneLabel(new Date("2026-12-04T13:00:00Z"))).toBe("GMT");
    expect(formatRange(new Date("2026-12-31T20:00:00Z"), new Date("2027-01-01T01:00:00Z"))).toBe("20:00–01:00 (next day)");
  });
  it("calendar maths", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // Sunday → Monday before
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(iso(startOfLondonDay("2026-07-01"))).toBe("2026-06-30T23:00:00.000Z");
    // The day the clocks go back has 25 hours.
    expect((startOfLondonDay("2026-10-26").getTime() - startOfLondonDay("2026-10-25").getTime()) / 3600_000).toBe(25);
  });
});
