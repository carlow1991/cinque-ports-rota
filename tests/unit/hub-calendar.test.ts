import { describe, expect, it } from "vitest";
import { eventTimeLabel, eventWindow, groupByDayAndPlace, overlaps, shiftToDate } from "@/lib/domain/hub-calendar";
import { formatTime } from "@/lib/time/london";

const iso = (s: string) => new Date(s).toISOString();

describe("event times are shown truthfully (C12)", () => {
  it("unknown finish is never invented", () => {
    expect(eventTimeLabel({ starts_at: iso("2026-10-24T10:30:00+01:00"), ends_at: null, kickoff_at: iso("2026-10-24T10:30:00+01:00") }))
      .toBe("Kick-off 10:30 — finish not recorded");
    expect(eventTimeLabel({ starts_at: iso("2026-10-24T19:00:00+01:00"), ends_at: null, kickoff_at: null })).toBe("From 19:00 — finish not recorded");
  });
  it("shows a range, a separate kick-off, and runs past midnight", () => {
    expect(eventTimeLabel({ starts_at: iso("2026-10-24T09:00:00+01:00"), ends_at: iso("2026-10-24T11:00:00+01:00"), kickoff_at: null })).toBe("09:00–11:00");
    expect(eventTimeLabel({ starts_at: iso("2026-10-24T13:30:00+01:00"), ends_at: iso("2026-10-24T17:00:00+01:00"), kickoff_at: iso("2026-10-24T15:00:00+01:00") })).toBe("13:30–17:00 · kick-off 15:00");
    expect(eventTimeLabel({ starts_at: iso("2026-10-24T20:00:00+01:00"), ends_at: iso("2026-10-25T01:00:00+01:00"), kickoff_at: null })).toBe("20:00–01:00 (next day)");
  });
});

describe("H15 — Europe/London clock changes", () => {
  it("refuses a time that doesn't exist (spring forward)", () => {
    const r = eventWindow({ date: "2027-03-28", start: "01:30" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/doesn't exist/);
  });
  it("flags the repeated autumn hour and uses the first (BST) occurrence", () => {
    const r = eventWindow({ date: "2026-10-25", start: "01:30", end: "03:00" });
    expect(r.ok && r.ambiguous).toBe(true);
    if (r.ok) {
      expect(r.startsAt.toISOString()).toBe("2026-10-25T00:30:00.000Z");
      expect(r.endsAt!.toISOString()).toBe("2026-10-25T03:00:00.000Z"); // 2h30 elapsed across the change
    }
  });
  it("stores instants: 10:00 in October (BST) and in November (GMT) are an hour apart in UTC", () => {
    const oct = eventWindow({ date: "2026-10-24", start: "10:00" });
    const nov = eventWindow({ date: "2026-11-07", start: "10:00" });
    expect(oct.ok && oct.startsAt.toISOString()).toBe("2026-10-24T09:00:00.000Z");
    expect(nov.ok && nov.startsAt.toISOString()).toBe("2026-11-07T10:00:00.000Z");
  });
  it("copying an event across the change keeps its UK wall-clock times (H13)", () => {
    const r = shiftToDate({ starts_at: iso("2026-10-24T09:00:00+01:00"), ends_at: iso("2026-10-24T11:00:00+01:00"), kickoff_at: null }, "2026-11-07");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(formatTime(r.startsAt)).toBe("09:00"); expect(formatTime(r.endsAt!)).toBe("11:00"); }
  });
  it("an unknown finish stays unknown when copied", () => {
    const r = shiftToDate({ starts_at: iso("2026-10-24T10:30:00+01:00"), ends_at: null, kickoff_at: iso("2026-10-24T10:30:00+01:00") }, "2026-10-31");
    expect(r.ok && r.endsAt).toBeNull();
  });
});

describe("validation", () => {
  it("finish at or before the start means the next day; over 24h refused", () => {
    const r = eventWindow({ date: "2026-11-07", start: "22:00", end: "02:00" });
    const dst = eventWindow({ date: "2026-10-24", start: "22:00", end: "02:00" }); // the night the clocks go back
    expect(dst.ok && (dst.endsAt!.getTime() - dst.startsAt.getTime()) / 3600_000).toBe(5);
    expect(r.ok && (r.endsAt!.getTime() - r.startsAt.getTime()) / 3600_000).toBe(4);
    const kick = eventWindow({ date: "2026-10-24", start: "09:00", end: "11:00", kickoff: "12:00" });
    expect(kick.ok).toBe(false);
  });
});

describe("C09 — overlapping events are grouped, never merged", () => {
  it("three Saturday events at one venue stay three cards", () => {
    const ev = (id: string, s: string, place: string) => ({ id, starts_at: iso(s), place });
    const g = groupByDayAndPlace([ev("v", "2026-10-24T10:30:00+01:00", "Marke Wood"), ev("m", "2026-10-24T09:00:00+01:00", "Marke Wood"),
      ev("y", "2026-10-24T09:00:00+01:00", "Marke Wood"), ev("l", "2026-10-25T14:00:00+00:00", "Deal")], (e) => e.place);
    expect(g).toHaveLength(2);
    expect(g[0].places[0].events.map((e) => e.id)).toEqual(["m", "y", "v"]);
    expect(g[1].places[0].place).toBe("Deal");
  });
  it("overlap is strict: back-to-back is not overlap", () => {
    expect(overlaps(9, 11, 11, 13)).toBe(false);
    expect(overlaps(9, 11, 10, 13)).toBe(true);
  });
});

import { eventsByDay, isMonthKey, monthGrid, monthLabel, shiftMonth, weekDays, weekLabel } from "@/lib/domain/hub-calendar";

describe("calendar views", () => {
  it("month grid: Monday-first full weeks covering the month", () => {
    const g = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(g[0][0]).toBe("2026-09-28");
    expect(g.at(-1)!.at(-1)).toBe("2026-11-01");
    expect(g).toHaveLength(5);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid("2027-02")).toHaveLength(4); // Feb 2027 starts on a Monday, 28 days
    expect(monthGrid("2026-08")).toHaveLength(6);
  });
  it("month arithmetic and labels", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-07")).toBe(true);
  });
  it("week days and labels, across a month end", () => {
    expect(weekDays("2026-10-26")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(weekLabel("2026-10-19")).toBe("19–25 Oct 2026");
    expect(weekLabel("2026-10-26")).toBe("26 Oct – 1 Nov 2026");
  });
  it("events land on their UK day, including late-evening BST and the clock-change weekend", () => {
    const m = eventsByDay([
      { starts_at: "2026-10-24T23:30:00Z" }, // 00:30 BST on Sun 25 Oct
      { starts_at: "2026-10-25T23:30:00Z" }, // 23:30 GMT on Sun 25 Oct
      { starts_at: "2026-10-25T09:00:00Z" },
    ]);
    expect(m.get("2026-10-25")?.length).toBe(3);
  });
});
