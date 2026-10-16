/**
 * Parse a PostgreSQL tstzrange / tstzmultirange text value into instants.
 * e.g. '{["2026-11-27 14:00:00+00","2026-11-27 15:00:00+00")}' → [{start, end}]
 */
export type Interval = { start: Date; end: Date };

const RANGE_RE = /[[(]"?([^",)\]]+)"?,"?([^",)\]]+)"?[)\]]/g;

function toDate(pg: string): Date {
  // Postgres prints "2026-11-27 14:00:00+00" / "...+01" / with fractions; make it ISO.
  let s = pg.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  return new Date(s);
}

export function parseRanges(text: string | null | undefined): Interval[] {
  if (!text || text === "{}" || text === "empty") return [];
  const out: Interval[] = [];
  for (const m of text.matchAll(RANGE_RE)) {
    const start = toDate(m[1]);
    const end = toDate(m[2]);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) out.push({ start, end });
  }
  return out;
}

export const COVER_EXPLANATION: Record<string, string> = {
  covered_by_volunteer: "A confirmed, authorised site lead covers the whole window, from the first setup to the end of cleaning.",
  covered_by_provider: "An administrator has recorded that the site is run by an external provider. No volunteer name is shown for provider cover.",
  not_required: "No club site lead is needed for this event.",
  at_risk: "Venue cover is arranged but not confirmed for the whole window. Check the gaps below.",
  no_cover: "The club is responsible for this site but there is no site-lead duty and no linked venue cover.",
};
