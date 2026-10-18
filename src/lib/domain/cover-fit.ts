/**
 * Shared venue cover helpers (brief §7). Pure: used for suggestions and previews only. Whether an
 * event is actually covered is always decided by the database (confirmed, eligible leads), never here.
 */
type Timed = { starts_at: string; ends_at: string };
export type Span = { start: number; end: number };

/** The time the club needs a site lead for: the event plus all its duties (setup before, cleaning after). */
export function requiredWindow(event: Timed, shifts: Timed[]): Span {
  const all = [event, ...shifts];
  return { start: Math.min(...all.map((x) => Date.parse(x.starts_at))), end: Math.max(...all.map((x) => Date.parse(x.ends_at))) };
}

export type Fit = { kind: "whole" } | { kind: "partial"; missing: Span[] } | { kind: "none" };

/** Does a cover event's PLANNED time span the required window? (Linking is never proof of cover.) */
export function coverFit(required: Span, cover: Timed): Fit {
  const s = Date.parse(cover.starts_at), e = Date.parse(cover.ends_at);
  if (e <= required.start || s >= required.end) return { kind: "none" };
  const missing: Span[] = [];
  if (s > required.start) missing.push({ start: required.start, end: s });
  if (e < required.end) missing.push({ start: e, end: required.end });
  return missing.length ? { kind: "partial", missing } : { kind: "whole" };
}

/** Best first: whole fit, then partial by least time missing; "none" left out. */
export function rankCover<T extends Timed>(required: Span, covers: T[]): { cover: T; fit: Fit }[] {
  const missingMs = (f: Fit) => (f.kind === "partial" ? f.missing.reduce((n, m) => n + m.end - m.start, 0) : 0);
  return covers
    .map((cover) => ({ cover, fit: coverFit(required, cover) }))
    .filter((x) => x.fit.kind !== "none")
    .sort((a, b) => Number(a.fit.kind !== "whole") - Number(b.fit.kind !== "whole") || missingMs(a.fit) - missingMs(b.fit));
}

export const MIN_PART_MS = 15 * 60_000;

/**
 * Mirror of split_site_lead_shift() for the preview: two parts meeting exactly at the handover;
 * opening stays with the first, locking up moves to the second, everything else stays on both.
 */
export function splitPreview(start: number, end: number, at: number, responsibilities: { code: string; name: string }[]):
  | { ok: true; first: Span & { includes: string[] }; second: Span & { includes: string[] } }
  | { ok: false; error: string } {
  if (!Number.isFinite(at) || at < start + MIN_PART_MS || at > end - MIN_PART_MS) {
    return { ok: false, error: "Choose a handover at least 15 minutes after the start and before the end." };
  }
  return {
    ok: true,
    first: { start, end: at, includes: responsibilities.filter((r) => r.code !== "lock_secure").map((r) => r.name) },
    second: { start: at, end, includes: responsibilities.filter((r) => r.code !== "open_unlock").map((r) => r.name) },
  };
}
