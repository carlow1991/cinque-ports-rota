/**
 * Pure staffing calculations over roster rows (one row per active assignment, or one empty row
 * for a duty with nobody). Headcount is per DUTY ROW: included responsibilities never add places.
 */
export type RosterLike = {
  event_id: string; event_title: string; venue_id: string; venue_name: string; team_name?: string | null;
  shift_id: string; duty_code: string; duty_name: string; shift_starts_at: string; shift_ends_at: string;
  required_count: number; volunteer_id: string | null; display_name: string | null;
  status: "invited" | "pending_approval" | "confirmed" | null;
};

export type ShiftStaffing = {
  shift_id: string; event_id: string; event_title: string; venue_id: string; venue_name: string; team_name: string | null;
  duty_code: string; duty_name: string; starts_at: string; ends_at: string;
  required: number; confirmed: number; pending: number; invited: number; open: number;
};

/** One entry per duty with exact counts. open = max(0, required − confirmed − pending). */
export function staffingByShift(rows: RosterLike[]): ShiftStaffing[] {
  const map = new Map<string, ShiftStaffing>();
  for (const r of rows) {
    let s = map.get(r.shift_id);
    if (!s) {
      s = {
        shift_id: r.shift_id, event_id: r.event_id, event_title: r.event_title, venue_id: r.venue_id, venue_name: r.venue_name,
        team_name: r.team_name ?? null, duty_code: r.duty_code, duty_name: r.duty_name, starts_at: r.shift_starts_at,
        ends_at: r.shift_ends_at, required: r.required_count, confirmed: 0, pending: 0, invited: 0, open: 0,
      };
      map.set(r.shift_id, s);
    }
    if (r.status === "confirmed") s.confirmed++;
    else if (r.status === "pending_approval") s.pending++;
    else if (r.status === "invited") s.invited++;
  }
  for (const s of map.values()) s.open = Math.max(0, s.required - s.confirmed - s.pending);
  return [...map.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.venue_name.localeCompare(b.venue_name));
}

export type TimelineSlot = { start: Date; end: Date; expected: number; names: string[] };

/**
 * "Expected on site": UNIQUE confirmed volunteers whose duty overlaps each slot at one venue.
 * A person on two back-to-back duties, or on a composite duty, counts once. This is an
 * expectation from confirmations, not proof anyone is present.
 */
export function expectedOnSite(rows: RosterLike[], venueId: string, from: Date, to: Date, stepMinutes = 30): TimelineSlot[] {
  const confirmed = rows.filter((r) => r.venue_id === venueId && r.status === "confirmed" && r.volunteer_id);
  if (confirmed.length === 0) return [];
  const first = Math.max(from.getTime(), Math.min(...confirmed.map((r) => Date.parse(r.shift_starts_at))));
  const last = Math.min(to.getTime(), Math.max(...confirmed.map((r) => Date.parse(r.shift_ends_at))));
  const step = stepMinutes * 60_000;
  const start = Math.floor(first / step) * step;
  const slots: TimelineSlot[] = [];
  for (let t = start; t < last; t += step) {
    const people = new Map<string, string>();
    for (const r of confirmed) {
      if (Date.parse(r.shift_starts_at) < t + step && t < Date.parse(r.shift_ends_at)) people.set(r.volunteer_id!, r.display_name ?? "");
    }
    slots.push({ start: new Date(t), end: new Date(t + step), expected: people.size, names: [...people.values()].sort() });
  }
  return slots;
}
