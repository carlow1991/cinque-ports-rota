import { londonParts, type DateKey } from "@/lib/time/london";

type Timed = { event_id: string; title: string; venue_id: string; starts_at: string; ends_at: string; status: string };

/**
 * Group events by the UK calendar days they touch (an event over midnight appears on both days)
 * and note same-venue overlaps, which are allowed and common (several fixtures on one site).
 */
export function groupByDay<T extends Timed>(events: T[], days: DateKey[]) {
  const out = new Map<DateKey, { event: T; overlapsWith: string[] }[]>(days.map((d) => [d, []]));
  const live = events.filter((e) => e.status !== "cancelled");
  for (const e of events) {
    const first = londonParts(new Date(e.starts_at)).dateKey;
    const last = londonParts(new Date(new Date(e.ends_at).getTime() - 1)).dateKey;
    const overlapsWith = e.status === "cancelled" ? [] : live
      .filter((o) => o.event_id !== e.event_id && o.venue_id === e.venue_id && o.starts_at < e.ends_at && e.starts_at < o.ends_at)
      .map((o) => o.title);
    for (const d of days) {
      if (d >= first && d <= last) out.get(d)!.push({ event: e, overlapsWith });
    }
  }
  return out;
}
