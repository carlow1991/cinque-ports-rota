/**
 * Readable template timing ↔ the stored signed offsets (minutes; negative = before). The stored
 * semantics are unchanged: a duty starts/ends at (event start or end) + offset.
 */
export type Anchor = "event_start" | "event_end";
export type Dir = "before" | "after";

export function offsetToParts(offset: number): { minutes: number; dir: Dir } {
  return { minutes: Math.abs(offset), dir: offset < 0 ? "before" : "after" };
}

export function offsetFromParts(minutes: number, dir: Dir): number {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return dir === "before" ? -m : m;
}

/** Plain sentence, e.g. "45 minutes before the event starts" / "when the event ends". */
export function describeTiming(anchor: Anchor, offset: number): string {
  const what = anchor === "event_start" ? "the event starts" : "the event ends";
  if (offset === 0) return `when ${what}`;
  const { minutes, dir } = offsetToParts(offset);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  const amount = h && m ? `${h} hr ${m} min` : h ? `${h} hr` : `${m} min`;
  return `${amount} ${dir} ${what}`;
}

/** Wall-clock sample for a typical 15:00–16:45 event (no dates or time zones involved). */
export const SAMPLE = { start: 15 * 60, end: 16 * 60 + 45 };

export function sampleTimes(sa: Anchor, so: number, ea: Anchor, eo: number):
  | { ok: true; text: string; minutes: number } | { ok: false } {
  const at = (a: Anchor, o: number) => (a === "event_start" ? SAMPLE.start : SAMPLE.end) + o;
  const s = at(sa, so), e = at(ea, eo);
  if (e <= s) return { ok: false };
  const clock = (x: number) => {
    const day = Math.floor(x / 1440), t = ((x % 1440) + 1440) % 1440;
    const hhmm = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    return day > 0 ? `${hhmm} (next day)` : day < 0 ? `${hhmm} (day before)` : hhmm;
  };
  return { ok: true, text: `${clock(s)}–${clock(e)}`, minutes: e - s };
}
