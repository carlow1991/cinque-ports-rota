/**
 * Template expansion: the preview the organiser sees. It MUST match the database's
 * _apply_template() exactly (a test cross-checks them); the database result is authoritative.
 */
export type Anchor = "event_start" | "event_end";

export type TemplateItem = {
  id: string;
  sortOrder: number;
  dutyCode: string;
  dutyName: string;
  requiredCount: number;
  enabledByDefault: boolean;
  whenToEnable: string | null;
  startAnchor: Anchor;
  startOffsetMinutes: number;
  endAnchor: Anchor;
  endOffsetMinutes: number;
  suppressedByLinkedCover: boolean;
  signupEnabled: boolean;
  approvalRequired: boolean;
  instructions: string | null;
  responsibilities: { code: string; name: string }[];
};

export type PlannedShift = {
  itemId: string;
  dutyCode: string;
  dutyName: string;
  startsAt: Date;
  endsAt: Date;
  requiredCount: number;
  responsibilities: { code: string; name: string }[];
};

export type SkippedItem = { itemId: string; dutyName: string; reason: "not_enabled" | "covered_by_linked_venue_cover" | "already_generated" };

export type Expansion = {
  shifts: PlannedShift[];
  skipped: SkippedItem[];
  /** Independently countable shift rows (composite responsibilities are NOT extra rows). */
  rows: number;
  /** Headcount slots across rows (composite responsibilities add no slots). */
  slots: number;
  problems: string[];
};

const MINUTE = 60_000;

function anchorTime(anchor: Anchor, start: Date, end: Date) {
  return anchor === "event_start" ? start.getTime() : end.getTime();
}

export function expandTemplate(
  event: { startsAt: Date; endsAt: Date; linkedToVenueCover: boolean },
  items: TemplateItem[],
  choices: { enabled?: ReadonlySet<string>; counts?: Readonly<Record<string, number>>; alreadyGenerated?: ReadonlySet<string> } = {},
): Expansion {
  const shifts: PlannedShift[] = [];
  const skipped: SkippedItem[] = [];
  const problems: string[] = [];

  for (const item of [...items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const enabled = choices.enabled ? choices.enabled.has(item.id) : item.enabledByDefault;
    if (!enabled) {
      skipped.push({ itemId: item.id, dutyName: item.dutyName, reason: "not_enabled" });
      continue;
    }
    if (item.suppressedByLinkedCover && event.linkedToVenueCover) {
      skipped.push({ itemId: item.id, dutyName: item.dutyName, reason: "covered_by_linked_venue_cover" });
      continue;
    }
    if (choices.alreadyGenerated?.has(item.id)) {
      skipped.push({ itemId: item.id, dutyName: item.dutyName, reason: "already_generated" });
      continue;
    }
    const count = choices.counts?.[item.id] ?? item.requiredCount;
    if (!Number.isInteger(count) || count < 1 || count > 50) problems.push(`${item.dutyName}: needs between 1 and 50 volunteers.`);
    const startsAt = new Date(anchorTime(item.startAnchor, event.startsAt, event.endsAt) + item.startOffsetMinutes * MINUTE);
    const endsAt = new Date(anchorTime(item.endAnchor, event.startsAt, event.endsAt) + item.endOffsetMinutes * MINUTE);
    if (startsAt >= endsAt) problems.push(`${item.dutyName}: would end before it starts. Check the event times.`);
    shifts.push({
      itemId: item.id,
      dutyCode: item.dutyCode,
      dutyName: item.dutyName,
      startsAt,
      endsAt,
      requiredCount: count,
      responsibilities: item.responsibilities,
    });
  }

  return {
    shifts,
    skipped,
    rows: shifts.length,
    slots: shifts.reduce((n, s) => n + s.requiredCount, 0),
    problems,
  };
}

/** Human description of an offset, e.g. "75 min before start", "45 min after end", "at end". */
export function describeOffset(anchor: Anchor, minutes: number): string {
  const where = anchor === "event_start" ? "start" : "end";
  if (minutes === 0) return `at ${where}`;
  const abs = Math.abs(minutes);
  const amount = abs % 60 === 0 ? `${abs / 60} h` : abs > 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return `${amount} ${minutes < 0 ? "before" : "after"} ${where}`;
}
