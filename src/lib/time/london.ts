/**
 * UK time handling. Everything is STORED as absolute instants (UTC timestamptz) and only
 * converted at the edges: organisers type UK wall-clock times; volunteers read UK times.
 * Uses the platform's IANA database (Intl), so BST/GMT changes are handled without a library.
 */
export const CLUB_TZ = "Europe/London";

export type DateKey = string; // "YYYY-MM-DD" (a UK calendar date)
export type WallTime = string; // "HH:MM" 24h

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CLUB_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** UK wall-clock parts of an instant. */
export function londonParts(instant: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(instant)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    dateKey: `${p.year}-${p.month}-${p.day}` as DateKey,
    time: `${p.hour}:${p.minute}` as WallTime,
  };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDateKey(s: string): s is DateKey {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export function isWallTime(s: string): s is WallTime {
  return TIME_RE.test(s);
}

export type WallTimeResult =
  | { ok: true; instant: Date; ambiguous: boolean }
  | { ok: false; reason: "invalid" | "nonexistent" };

/**
 * Convert a UK date + wall-clock time to an instant.
 *  - Spring forward (e.g. 01:30 on the last Sunday of March) does not exist → "nonexistent".
 *  - Autumn back (01:30 on the last Sunday of October) happens twice → the FIRST (BST)
 *    occurrence is used and `ambiguous` is true so the UI can say so.
 */
export function londonToInstant(date: string, time: string): WallTimeResult {
  if (!isDateKey(date) || !isWallTime(time)) return { ok: false, reason: "invalid" };
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const matches: number[] = [];
  // UK offsets are only ever +0 (GMT) or +1h (BST). Earlier instant first.
  for (const offsetMin of [60, 0]) {
    const candidate = asUtc - offsetMin * 60_000;
    const p = londonParts(new Date(candidate));
    if (p.dateKey === date && p.time === time) matches.push(candidate);
  }
  if (matches.length === 0) return { ok: false, reason: "nonexistent" };
  return { ok: true, instant: new Date(matches[0]), ambiguous: matches.length > 1 };
}

/**
 * Event window from a UK date and start/end wall times. An end time at or before the start
 * means the event runs past midnight into the next day.
 */
export function londonWindow(date: string, start: string, end: string):
  | { ok: true; startsAt: Date; endsAt: Date; crossesMidnight: boolean; ambiguous: boolean }
  | { ok: false; error: string } {
  const s = londonToInstant(date, start);
  if (!s.ok) return { ok: false, error: s.reason === "nonexistent" ? `${start} doesn't exist on ${formatDateKey(date)} (the clocks go forward).` : "Enter a valid date and start time." };
  const crossesMidnight = isWallTime(end) && end <= start;
  const endDate = crossesMidnight ? addDays(date, 1) : date;
  const e = londonToInstant(endDate, end);
  if (!e.ok) return { ok: false, error: e.reason === "nonexistent" ? `${end} doesn't exist on ${formatDateKey(endDate)} (the clocks go forward).` : "Enter a valid end time." };
  if (e.instant <= s.instant) return { ok: false, error: "The end time must be after the start time." };
  if (e.instant.getTime() - s.instant.getTime() > 24 * 3600_000) return { ok: false, error: "An event can last at most 24 hours." };
  return { ok: true, startsAt: s.instant, endsAt: e.instant, crossesMidnight, ambiguous: s.ambiguous || e.ambiguous };
}

/** Calendar arithmetic on UK dates (no time zone involved). */
export function addDays(date: DateKey, days: number): DateKey {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Monday of the UK week containing `date`. */
export function startOfWeek(date: DateKey): DateKey {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export function todayKey(now: Date = new Date()): DateKey {
  return londonParts(now).dateKey;
}

/** First instant of a UK calendar day (handles 23h/25h days). */
export function startOfLondonDay(date: DateKey): Date {
  const r = londonToInstant(date, "00:00");
  if (r.ok) return r.instant;
  // Midnight never falls in the UK DST gap, but be defensive.
  return (londonToInstant(date, "01:00") as { ok: true; instant: Date }).instant;
}

const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: CLUB_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtDay = new Intl.DateTimeFormat("en-GB", { timeZone: CLUB_TZ, weekday: "short", day: "numeric", month: "short" });
const fmtLongDay = new Intl.DateTimeFormat("en-GB", { timeZone: CLUB_TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtZone = new Intl.DateTimeFormat("en-GB", { timeZone: CLUB_TZ, timeZoneName: "short" });

export const formatTime = (d: Date) => fmtTime.format(d);
export const formatDay = (d: Date) => fmtDay.format(d);
export const formatLongDay = (d: Date) => fmtLongDay.format(d);
/** "GMT" or "BST" for that instant. */
export const zoneLabel = (d: Date) => fmtZone.formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "UK";

export function formatDateKey(date: DateKey): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** "14:30–16:45", adding "(next day)" when the end falls on a later UK date. */
export function formatRange(start: Date, end: Date): string {
  const nextDay = londonParts(end).dateKey !== londonParts(start).dateKey;
  return `${formatTime(start)}–${formatTime(end)}${nextDay ? " (next day)" : ""}`;
}
