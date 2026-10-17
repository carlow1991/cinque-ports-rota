import { describe, expect, it } from "vitest";
import { groupMyDuties, pickTab } from "@/lib/domain/my-duties";
import { buildIcs, icsEscape } from "@/lib/ics";

const NOW = Date.parse("2026-10-17T09:00:00Z");
const d = (status: string, startH: number, endH: number, changedH = -1) => ({
  status,
  starts_at: new Date(NOW + startH * 3600_000).toISOString(),
  ends_at: new Date(NOW + endH * 3600_000).toISOString(),
  status_changed_at: new Date(NOW + changedH * 3600_000).toISOString(),
});

describe("groupMyDuties", () => {
  const duties = [
    d("confirmed", 10, 12), d("confirmed", -30, -28), d("invited", 50, 52), d("pending_approval", 60, 61),
    d("cancelled", 70, 72, -2), d("cancelled", 70, 72, -24 * 20), d("declined", 80, 81), d("withdrawn", 90, 91),
    d("confirmed", -1, 1), // in progress counts as upcoming
  ];
  const { groups, recentChanges } = groupMyDuties(duties, NOW);
  it("splits into tabs; an in-progress duty is still 'confirmed', not past", () => {
    expect(groups.confirmed).toHaveLength(2);
    expect(groups.invited).toHaveLength(1);
    expect(groups.pending).toHaveLength(1);
    expect(groups.past).toHaveLength(1);
  });
  it("surfaces only RECENT cancellations of upcoming duties; declined/withdrawn are not alerts", () => {
    expect(recentChanges).toHaveLength(1);
  });
  it("opens on invitations when any are waiting", () => {
    expect(pickTab(undefined, groups)).toBe("invited");
    expect(pickTab("past", groups)).toBe("past");
    expect(pickTab("nonsense", { ...groups, invited: [] })).toBe("confirmed");
  });
});

describe("calendar file", () => {
  it("escapes text and writes UTC times", () => {
    expect(icsEscape("Cleaning; bins, mops\nthen lock")).toBe("Cleaning\\; bins\\, mops\\nthen lock");
    const ics = buildIcs({
      uid: "abc", start: new Date("2026-10-24T14:00:00Z"), end: new Date("2026-10-24T15:45:00Z"),
      summary: "Post-event cleaning: First Team v Example Town", location: "Marke Wood", now: new Date("2026-10-17T09:00:00Z"),
    });
    expect(ics).toContain("DTSTART:20261024T140000Z");
    expect(ics).toContain("DTEND:20261024T154500Z");
    expect(ics).toContain("UID:abc@rota.cinqueportsfc");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("folds long lines", () => {
    const ics = buildIcs({ uid: "x", start: new Date(0), end: new Date(3600_000), summary: "A".repeat(200) });
    expect(ics).toMatch(/\r\n A/);
  });
});
