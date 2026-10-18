/** Shared venue cover presentation (pure). The cover is one record; events only ever show it as context. */
import { formatTime, londonParts } from "@/lib/time/london";

export type CoverLike = { venue_id: string; begins_at: string; ends_at: string; events: number; label: string | null; name: string; state: string };

export function coverLine(c: CoverLike): string {
  const t = `${formatTime(new Date(c.begins_at))}–${formatTime(new Date(c.ends_at))}`;
  return [c.name, c.label, t].filter(Boolean).join(" — ");
}

export function alsoSupports(n: number): string {
  if (n <= 0) return "No club events overlap yet";
  return n === 1 ? "Also supports 1 overlapping event" : `Also supports ${n} overlapping events`;
}

/** Covers starting on this UK day at this venue (shown ONCE as a band above that venue's events). */
export function coversFor<T extends CoverLike>(covers: T[], dateKey: string, venueId: string | null): T[] {
  if (!venueId) return [];
  return covers.filter((c) => c.venue_id === venueId && londonParts(new Date(c.begins_at)).dateKey === dateKey);
}
