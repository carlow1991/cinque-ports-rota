import { describe, expect, it } from "vitest";
import { describeTiming, offsetFromParts, offsetToParts, sampleTimes } from "@/lib/domain/template-timing";

describe("template timing ↔ stored offsets", () => {
  it("round-trips every stored offset exactly (no change to existing semantics)", () => {
    for (const o of [-1440, -90, -45, -1, 0, 1, 30, 45, 75, 1440]) {
      const p = offsetToParts(o);
      expect(offsetFromParts(p.minutes, p.dir)).toBe(o);
    }
  });
  it("before = negative, after = positive, zero has no sign", () => {
    expect(offsetFromParts(75, "before")).toBe(-75);
    expect(offsetFromParts(45, "after")).toBe(45);
    expect(Object.is(offsetFromParts(0, "before"), 0) || offsetFromParts(0, "before") === 0).toBe(true);
  });
  it("reads as plain English", () => {
    expect(describeTiming("event_start", -75)).toBe("1 hr 15 min before the event starts");
    expect(describeTiming("event_end", 45)).toBe("45 min after the event ends");
    expect(describeTiming("event_start", 0)).toBe("when the event starts");
    expect(describeTiming("event_end", -60)).toBe("1 hr before the event ends");
  });
  it("sample for a 15:00–16:45 event, and refuses a duty that ends before it starts", () => {
    expect(sampleTimes("event_start", -45, "event_start", 0)).toEqual({ ok: true, text: "14:15–15:00", minutes: 45 });
    expect(sampleTimes("event_end", 0, "event_end", 30)).toEqual({ ok: true, text: "16:45–17:15", minutes: 30 });
    expect(sampleTimes("event_end", 0, "event_start", 0)).toEqual({ ok: false });
    expect(sampleTimes("event_end", 420, "event_end", 480).ok && sampleTimes("event_end", 420, "event_end", 480)).toMatchObject({ text: "23:45–00:45 (next day)" });
  });
});
