/**
 * Volunteer Hub calendar rules (pure, tested). Instants are absolute; UK wall-clock only at the edges.
 */
import { addDays, formatDateKey, formatTime, londonParts, londonToInstant, type DateKey } from "@/lib/time/london";

export const CATEGORIES = [
  { code: "match", label: "Match" },
  { code: "training", label: "Training" },
  { code: "mini_kickers", label: "Mini Kickers" },
  { code: "youth", label: "Youth football" },
  { code: "meeting", label: "Meeting" },
  { code: "social", label: "Social / fundraiser" },
  { code: "maintenance", label: "Working party / maintenance" },
  { code: "other", label: "Other" },
] as const;
export type Category = (typeof CATEGORIES)[number]["code"];
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.code === c)?.label ?? "Other";

export type HubEvent = {
  id: string; title: string; category: string; status: string;
  starts_at: string; ends_at: string | null; kickoff_at: string | null;
  venue_id: string | null; external_location_text: string | null; team_id: string | null;
  volunteers_enabled: boolean; description: string | null; opponent: string | null; competition: string | null;
  cancel_reason: string | null; organiser_person_id: string | null; is_demo: boolean;
};

/** "09:00–11:00", or "Kick-off 10:30 — finish not recorded". Never guesses a finish. */
export function eventTimeLabel(e: Pick<HubEvent, "starts_at" | "ends_at" | "kickoff_at">): string {
  const start = new Date(e.starts_at);
  const kick = e.kickoff_at ? new Date(e.kickoff_at) : null;
  if (!e.ends_at) {
    return kick ? `Kick-off ${formatTime(kick)} — finish not recorded` : `From ${formatTime(start)} — finish not recorded`;
  }
  const end = new Date(e.ends_at);
  const nextDay = londonParts(end).dateKey !== londonParts(start).dateKey;
  const range = `${formatTime(start)}–${formatTime(end)}${nextDay ? " (next day)" : ""}`;
  return kick && kick.getTime() !== start.getTime() ? `${range} · kick-off ${formatTime(kick)}` : range;
}

/** Group events by UK day, then by location (venue name or outside location), keeping each event separate. */
export function groupByDayAndPlace<T extends Pick<HubEvent, "starts_at">>(events: T[], placeOf: (e: T) => string) {
  const days = new Map<DateKey, Map<string, T[]>>();
  for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const day = londonParts(new Date(e.starts_at)).dateKey;
    const places = days.get(day) ?? new Map<string, T[]>();
    const place = placeOf(e);
    places.set(place, [...(places.get(place) ?? []), e]);
    days.set(day, places);
  }
  return [...days.entries()].map(([day, places]) => ({ day, label: formatDateKey(day), places: [...places.entries()].map(([place, list]) => ({ place, events: list })) }));
}

export type WindowInput = { date: string; start: string; end?: string; kickoff?: string };
export type WindowResult =
  | { ok: true; startsAt: Date; endsAt: Date | null; kickoffAt: Date | null; ambiguous: boolean }
  | { ok: false; error: string };

/**
 * UK date + start (+ optional finish, + optional kick-off) → instants. A finish at or before the start
 * means past midnight. Non-existent clock-change times are refused with a clear message; the
 * repeated autumn hour uses the first (BST) occurrence and is flagged.
 */
export function eventWindow({ date, start, end, kickoff }: WindowInput): WindowResult {
  const s = londonToInstant(date, start);
  if (!s.ok) return { ok: false, error: s.reason === "nonexistent" ? `${start} doesn't exist on ${formatDateKey(date)} (the clocks go forward).` : "Enter a valid date and start time." };
  let endsAt: Date | null = null;
  let ambiguous = s.ambiguous;
  if (end) {
    const endDate = end <= start ? addDays(date, 1) : date;
    const e = londonToInstant(endDate, end);
    if (!e.ok) return { ok: false, error: e.reason === "nonexistent" ? `${end} doesn't exist on ${formatDateKey(endDate)} (the clocks go forward).` : "Enter a valid finish time." };
    if (e.instant <= s.instant) return { ok: false, error: "The finish must be after the start." };
    if (e.instant.getTime() - s.instant.getTime() > 24 * 3600_000) return { ok: false, error: "An event can last at most 24 hours." };
    endsAt = e.instant;
    ambiguous ||= e.ambiguous;
  }
  let kickoffAt: Date | null = null;
  if (kickoff) {
    const k = londonToInstant(kickoff < start ? addDays(date, 1) : date, kickoff);
    if (!k.ok) return { ok: false, error: "Enter a valid kick-off time." };
    if (endsAt && k.instant > endsAt) return { ok: false, error: "Kick-off must be before the finish." };
    kickoffAt = k.instant;
  }
  return { ok: true, startsAt: s.instant, endsAt, kickoffAt, ambiguous };
}

/** Copy an event to another UK date, keeping its UK wall-clock times (not elapsed UTC offsets). */
export function shiftToDate(e: Pick<HubEvent, "starts_at" | "ends_at" | "kickoff_at">, newDate: DateKey): WindowResult {
  const s = londonParts(new Date(e.starts_at));
  return eventWindow({
    date: newDate,
    start: s.time,
    end: e.ends_at ? londonParts(new Date(e.ends_at)).time : undefined,
    kickoff: e.kickoff_at ? londonParts(new Date(e.kickoff_at)).time : undefined,
  });
}

/** Two intervals overlap when each starts before the other ends (back-to-back is not overlap). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// ---------------------------------------------------------------------------
// Calendar views (pure). Weeks start on Monday; all arithmetic is on UK calendar dates.
// ---------------------------------------------------------------------------
export type MonthKey = string; // "YYYY-MM"
export const isMonthKey = (s: string): s is MonthKey => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const monthOf = (d: DateKey): MonthKey => d.slice(0, 7);

export function shiftMonth(m: MonthKey, by: number): MonthKey {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + by, 1));
  return t.toISOString().slice(0, 7);
}

export function monthLabel(m: MonthKey): string {
  const [y, mo] = m.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, mo - 1, 15)));
}

/** Full Monday-to-Sunday weeks covering the month (4–6 rows), including the edge days of the neighbouring months. */
export function monthGrid(m: MonthKey): DateKey[][] {
  const first = `${m}-01`;
  const [y, mo] = m.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const dow = (d: DateKey) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  let day = addDays(first, -dow(first));
  const weeks: DateKey[][] = [];
  while (day <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
    day = addDays(day, 7);
  }
  return weeks;
}

/** The seven days of the week starting on `monday`. */
export const weekDays = (monday: DateKey): DateKey[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** Short label for a week: "19–25 Oct 2026" or "26 Oct – 1 Nov 2026". */
export function weekLabel(monday: DateKey): string {
  const sunday = addDays(monday, 6);
  const f = (d: DateKey, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...o }).format(new Date(`${d}T12:00:00Z`));
  return monday.slice(0, 7) === sunday.slice(0, 7)
    ? `${f(monday, { day: "numeric" })}–${f(sunday, { day: "numeric", month: "short", year: "numeric" })}`
    : `${f(monday, { day: "numeric", month: "short" })} – ${f(sunday, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Events keyed by the UK day they start on. */
export function eventsByDay<T extends Pick<HubEvent, "starts_at">>(events: T[]): Map<DateKey, T[]> {
  const out = new Map<DateKey, T[]>();
  for (const e of [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))) {
    const d = londonParts(new Date(e.starts_at)).dateKey;
    out.set(d, [...(out.get(d) ?? []), e]);
  }
  return out;
}
