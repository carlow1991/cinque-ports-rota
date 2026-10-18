/**
 * Plain-English duty timing for volunteers. Durations are measured between real instants, so a
 * duty across the October/March clock change shows its true length.
 */
export function formatDuration(start: Date, end: Date): string {
  const mins = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** The next upcoming confirmed duty (not yet finished), soonest first. */
export function nextConfirmed<T extends { status: string; starts_at: string; ends_at: string }>(duties: T[], now: number): T | null {
  return duties
    .filter((d) => d.status === "confirmed" && Date.parse(d.ends_at) > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;
}
