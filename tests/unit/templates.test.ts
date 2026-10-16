import { describe, expect, it } from "vitest";
import { describeOffset, expandTemplate, type TemplateItem } from "@/lib/domain/templates";

const BUNDLE = [
  { code: "open_unlock", name: "Open and unlock facilities" },
  { code: "facility_checks", name: "Changing room / facility checks" },
  { code: "lock_secure", name: "Lock and secure facilities" },
];

function item(o: Partial<TemplateItem> & Pick<TemplateItem, "id" | "dutyCode" | "requiredCount" | "enabledByDefault">): TemplateItem {
  return {
    sortOrder: 0, dutyName: o.dutyCode, whenToEnable: null, startAnchor: "event_start", startOffsetMinutes: 0,
    endAnchor: "event_end", endOffsetMinutes: 0, suppressedByLinkedCover: false, signupEnabled: true,
    approvalRequired: false, instructions: null, responsibilities: [], ...o,
  };
}

// T01 exactly as seeded (Catalogue §4).
const T01: TemplateItem[] = [
  item({ id: "lead", sortOrder: 10, dutyCode: "site_lead", requiredCount: 1, enabledByDefault: true, startOffsetMinutes: -75, endOffsetMinutes: 45, suppressedByLinkedCover: true, responsibilities: BUNDLE }),
  item({ id: "gate", sortOrder: 20, dutyCode: "gate_admissions", requiredCount: 1, enabledByDefault: false, startOffsetMinutes: -45, endAnchor: "event_start", endOffsetMinutes: 20 }),
  item({ id: "tea", sortOrder: 30, dutyCode: "refreshments", requiredCount: 2, enabledByDefault: false, startOffsetMinutes: -45, endOffsetMinutes: 30 }),
  item({ id: "setup", sortOrder: 40, dutyCode: "pitch_setup", requiredCount: 2, enabledByDefault: true, startOffsetMinutes: -75, endAnchor: "event_start", endOffsetMinutes: -15 }),
  item({ id: "clean", sortOrder: 50, dutyCode: "cleaning", requiredCount: 2, enabledByDefault: true, startAnchor: "event_end", endOffsetMinutes: 45 }),
  item({ id: "help", sortOrder: 60, dutyCode: "general_support", requiredCount: 1, enabledByDefault: false, startOffsetMinutes: -30, endOffsetMinutes: 15 }),
];

const ko = new Date("2026-09-05T14:00:00Z"); // 15:00 BST kick-off
const ft = new Date("2026-09-05T15:50:00Z"); // planned end
const EV = { startsAt: ko, endsAt: ft, linkedToVenueCover: false };

describe("expandTemplate", () => {
  it("T01 default: 3 rows, 5 slots; site lead carries open/check/lock as included duties", () => {
    const x = expandTemplate(EV, T01);
    expect(x.rows).toBe(3);
    expect(x.slots).toBe(5);
    expect(x.shifts.find((s) => s.dutyCode === "site_lead")!.responsibilities.map((r) => r.code)).toEqual(["open_unlock", "facility_checks", "lock_secure"]);
    expect(x.shifts.map((s) => s.dutyCode)).not.toContain("open_unlock");
  });

  it("T01 with gate and tea bar: exactly 5 rows and 8 slots", () => {
    const x = expandTemplate(EV, T01, { enabled: new Set(["lead", "gate", "tea", "setup", "clean"]) });
    expect(x.rows).toBe(5);
    expect(x.slots).toBe(8);
    expect(x.shifts.map((s) => s.dutyCode)).toEqual(["site_lead", "gate_admissions", "refreshments", "pitch_setup", "cleaning"]);
  });

  it("disabled optional duties produce no rows at all (no phantom vacancies)", () => {
    const x = expandTemplate(EV, T01);
    expect(x.shifts.some((s) => ["gate_admissions", "refreshments", "general_support"].includes(s.dutyCode))).toBe(false);
    expect(x.skipped.filter((s) => s.reason === "not_enabled").map((s) => s.itemId).sort()).toEqual(["gate", "help", "tea"]);
  });

  it("linked venue cover suppresses the site-lead row (never a duplicate vacancy)", () => {
    const x = expandTemplate({ ...EV, linkedToVenueCover: true }, T01);
    expect(x.shifts.map((s) => s.dutyCode)).toEqual(["pitch_setup", "cleaning"]);
    expect(x.skipped).toContainEqual(expect.objectContaining({ itemId: "lead", reason: "covered_by_linked_venue_cover" }));
  });

  it("before-start and after-end offsets are applied to the right anchor", () => {
    const x = expandTemplate(EV, T01, { enabled: new Set(["lead", "gate", "setup", "clean"]) });
    const at = (code: string) => x.shifts.find((s) => s.dutyCode === code)!;
    expect(at("site_lead").startsAt.toISOString()).toBe("2026-09-05T12:45:00.000Z"); // KO −75
    expect(at("site_lead").endsAt.toISOString()).toBe("2026-09-05T16:35:00.000Z");   // end +45
    expect(at("gate_admissions").endsAt.toISOString()).toBe("2026-09-05T14:20:00.000Z"); // KO +20
    expect(at("pitch_setup").endsAt.toISOString()).toBe("2026-09-05T13:45:00.000Z");     // KO −15
    expect(at("cleaning").startsAt.toISOString()).toBe("2026-09-05T15:50:00.000Z");      // at end
  });

  it("offsets are real elapsed minutes across the spring clock change", () => {
    // Kick-off 03:00 BST on 29 Mar 2026 (= 02:00 UTC). Setup 75 min earlier = 00:45 UTC = 00:45 GMT.
    const x = expandTemplate({ startsAt: new Date("2026-03-29T02:00:00Z"), endsAt: new Date("2026-03-29T03:00:00Z"), linkedToVenueCover: false }, T01);
    const setup = x.shifts.find((s) => s.dutyCode === "pitch_setup")!;
    expect(setup.startsAt.toISOString()).toBe("2026-03-29T00:45:00.000Z");
    expect((x.shifts[0].endsAt.getTime() - x.shifts[0].startsAt.getTime()) / 60000).toBe(75 + 60 + 45);
  });

  it("cross-midnight: cleaning after a late event lands on the next day", () => {
    const x = expandTemplate({ startsAt: new Date("2026-06-20T21:00:00Z"), endsAt: new Date("2026-06-20T22:45:00Z"), linkedToVenueCover: false }, T01);
    const clean = x.shifts.find((s) => s.dutyCode === "cleaning")!;
    expect(clean.endsAt.toISOString()).toBe("2026-06-20T23:30:00.000Z"); // 00:30 BST on 21 June
  });

  it("count overrides and validation", () => {
    const x = expandTemplate(EV, T01, { counts: { setup: 1, clean: 0 } });
    expect(x.shifts.find((s) => s.dutyCode === "pitch_setup")!.requiredCount).toBe(1);
    expect(x.problems.join()).toMatch(/cleaning: needs between 1 and 50/);
  });

  it("flags a duty that would end before it starts", () => {
    const x = expandTemplate({ startsAt: ko, endsAt: new Date(ko.getTime() + 5 * 60000), linkedToVenueCover: false },
      [item({ id: "bad", dutyCode: "cleaning", requiredCount: 1, enabledByDefault: true, startAnchor: "event_end", startOffsetMinutes: 30, endAnchor: "event_start", endOffsetMinutes: 0 })]);
    expect(x.problems).toHaveLength(1);
  });

  it("does not regenerate items already on the event", () => {
    const x = expandTemplate(EV, T01, { alreadyGenerated: new Set(["setup"]) });
    expect(x.shifts.map((s) => s.dutyCode)).toEqual(["site_lead", "cleaning"]);
  });
});

describe("describeOffset", () => {
  it.each([
    ["event_start", -75, "1 h 15 min before start"],
    ["event_start", -45, "45 min before start"],
    ["event_end", 45, "45 min after end"],
    ["event_end", 0, "at end"],
    ["event_start", -60, "1 h before start"],
  ] as const)("%s %i → %s", (a, m, out) => {
    expect(describeOffset(a, m)).toBe(out);
  });
});
