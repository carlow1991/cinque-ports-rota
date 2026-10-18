import { describe, expect, it } from "vitest";
import { coverFit, rankCover, requiredWindow, splitPreview } from "@/lib/domain/cover-fit";

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 7, h, m)).toISOString();
const ms = (h: number, m = 0) => Date.UTC(2026, 10, 7, h, m);

describe("required window", () => {
  it("is the event plus its duties before and after (Catalogue §6: setup 08:15, cleaning to 12:30)", () => {
    const w = requiredWindow({ starts_at: t(9), ends_at: t(12) }, [{ starts_at: t(8, 15), ends_at: t(9) }, { starts_at: t(12), ends_at: t(12, 30) }]);
    expect(w).toEqual({ start: ms(8, 15), end: ms(12, 30) });
  });
});

describe("cover suggestions use the real operational window", () => {
  const need = { start: ms(8, 15), end: ms(12, 30) };
  it("whole fit, partial fit with the exact missing times, and no overlap", () => {
    expect(coverFit(need, { starts_at: t(8), ends_at: t(14) })).toEqual({ kind: "whole" });
    expect(coverFit(need, { starts_at: t(9), ends_at: t(14) })).toEqual({ kind: "partial", missing: [{ start: ms(8, 15), end: ms(9) }] });
    expect(coverFit(need, { starts_at: t(13), ends_at: t(15) })).toEqual({ kind: "none" });
  });
  it("a cover that matches the event but not its setup/cleaning duties is only partial", () => {
    const f = coverFit(need, { starts_at: t(9), ends_at: t(12) });
    expect(f.kind).toBe("partial");
  });
  it("ranks whole fits first, then least time missing; drops non-overlapping", () => {
    const r = rankCover(need, [
      { id: "far", starts_at: t(16), ends_at: t(18) },
      { id: "short", starts_at: t(10), ends_at: t(14) },
      { id: "nearly", starts_at: t(8, 30), ends_at: t(14) },
      { id: "whole", starts_at: t(8), ends_at: t(14) },
    ]);
    expect(r.map((x) => x.cover.id)).toEqual(["whole", "nearly", "short"]);
  });
});

describe("split preview mirrors the database split", () => {
  const resp = [{ code: "open_unlock", name: "Open and unlock" }, { code: "facility_checks", name: "Facility checks" }, { code: "lock_secure", name: "Lock and secure" }];
  it("meets exactly at the handover; opening first, locking second, checks on both", () => {
    const p = splitPreview(ms(8), ms(14), ms(11), resp);
    expect(p).toEqual({ ok: true,
      first: { start: ms(8), end: ms(11), includes: ["Open and unlock", "Facility checks"] },
      second: { start: ms(11), end: ms(14), includes: ["Facility checks", "Lock and secure"] } });
  });
  it("refuses a handover within 15 minutes of either end", () => {
    expect(splitPreview(ms(8), ms(14), ms(8, 10), resp).ok).toBe(false);
    expect(splitPreview(ms(8), ms(14), ms(13, 50), resp).ok).toBe(false);
    expect(splitPreview(ms(8), ms(14), ms(8, 15), resp).ok).toBe(true);
  });
});
