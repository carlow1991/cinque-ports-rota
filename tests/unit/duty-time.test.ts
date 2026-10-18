import { describe, expect, it } from "vitest";
import { formatDuration, nextConfirmed } from "@/lib/domain/duty-time";
import { formatTime } from "@/lib/time/london";

describe("formatDuration", () => {
  it("reads naturally", () => {
    const t = (iso: string) => new Date(iso);
    expect(formatDuration(t("2026-11-01T10:00:00Z"), t("2026-11-01T10:45:00Z"))).toBe("45 min");
    expect(formatDuration(t("2026-11-01T10:00:00Z"), t("2026-11-01T11:00:00Z"))).toBe("1 hr");
    expect(formatDuration(t("2026-11-01T10:00:00Z"), t("2026-11-01T11:30:00Z"))).toBe("1 hr 30 min");
  });
  it("uses the real length across the October clock change (UK)", () => {
    // 00:30 BST → 02:30 GMT on Sunday 25 October 2026: the wall clock says 2 hours, it is really 3.
    const start = new Date("2026-10-24T23:30:00Z"), end = new Date("2026-10-25T02:30:00Z");
    expect([formatTime(start), formatTime(end)]).toEqual(["00:30", "02:30"]);
    expect(formatDuration(start, end)).toBe("3 hr");
  });
});

describe("nextConfirmed", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  const d = (status: string, s: string, e: string) => ({ status, starts_at: s, ends_at: e });
  it("picks the soonest confirmed duty that has not finished; ignores invited, pending, cancelled and past", () => {
    const list = [
      d("confirmed", "2026-10-25T10:00:00Z", "2026-10-25T11:00:00Z"),
      d("invited", "2026-10-19T10:00:00Z", "2026-10-19T11:00:00Z"),
      d("pending_approval", "2026-10-19T09:00:00Z", "2026-10-19T10:00:00Z"),
      d("cancelled", "2026-10-19T08:00:00Z", "2026-10-19T09:00:00Z"),
      d("confirmed", "2026-10-17T10:00:00Z", "2026-10-17T11:00:00Z"),
      d("confirmed", "2026-10-18T11:30:00Z", "2026-10-18T13:00:00Z"), // in progress now
    ];
    expect(nextConfirmed(list, now)?.starts_at).toBe("2026-10-18T11:30:00Z");
    expect(nextConfirmed([], now)).toBeNull();
  });
});
