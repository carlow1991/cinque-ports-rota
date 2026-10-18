/**
 * The organiser's attention list: one ordered list of things that need someone to act, built from
 * data the app already loads (events overview, roster staffing, action queue, exact cover gaps).
 * Pure, so the ordering rules are unit-tested. Nothing here decides cover: cover_state comes from
 * the database's single coverage calculation.
 *
 * Order (brief §2): imminent critical items first (late cancellations; missing site lead or open
 * places within IMMINENT_HOURS), then later site-lead gaps, open places, reconfirmations,
 * approvals, unanswered invitations, unpublished drafts. Within a tier: soonest first.
 */

export const IMMINENT_HOURS = 72;

export type AttentionTier = "urgent" | "site_lead" | "open" | "reconfirm" | "approval" | "invitation" | "draft";
const TIER_ORDER: AttentionTier[] = ["urgent", "site_lead", "open", "reconfirm", "approval", "invitation", "draft"];

export const TIER_LABEL: Record<AttentionTier, string> = {
  urgent: "Urgent", site_lead: "Site lead", open: "Places open", reconfirm: "Reconfirm",
  approval: "Approval", invitation: "No answer", draft: "Draft",
};

export type AttentionItem = {
  key: string; tier: AttentionTier; venue: string; eventId: string; eventTitle: string;
  /** The duty (or event) time the row is about. */
  startsAt: string; endsAt: string; duty: string | null; reason: string;
  action: { label: string; href: string };
};

export type AttEvent = {
  event_id: string; title: string; status: string; venue_name: string; starts_at: string; ends_at: string;
  coverage_event_id: string | null; cover_state: string | null;
};
export type AttShift = {
  shift_id: string; event_id: string; event_title: string; venue_name: string; duty_code: string; duty_name: string;
  starts_at: string; ends_at: string; required: number; confirmed: number; pending: number; open: number;
};
export type AttQueue = {
  kind: "approval" | "invitation" | "reconfirmation" | "cancellation"; assignment_id: string; request_id: string | null;
  event_id: string; event_title: string; venue_name: string; duty_name: string; shift_starts_at: string; shift_ends_at: string;
  display_name: string; reason: string | null;
};
export type Gap = { start: Date; end: Date };

const LIVE = new Set(["published", "draft", "postponed"]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildAttention(input: {
  events: AttEvent[]; shifts: AttShift[]; queue: AttQueue[]; gaps: Map<string, Gap[]>;
  from: Date; to: Date; now: Date; formatRange: (a: Date, b: Date) => string;
}): { items: AttentionItem[]; laterRequests: number } {
  const { events, shifts, queue, gaps, from, to, now, formatRange } = input;
  const soon = now.getTime() + IMMINENT_HOURS * 3_600_000;
  const imminent = (iso: string) => Date.parse(iso) <= soon;
  const inRange = (start: string, end: string) => Date.parse(start) < to.getTime() && Date.parse(end) > from.getTime();
  const items: AttentionItem[] = [];
  const byId = new Map(events.map((e) => [e.event_id, e]));

  // Missing / at-risk site lead (per event, from the database's cover_state).
  const leadGapEvents = new Set<string>();
  for (const e of events) {
    if (!LIVE.has(e.status) || e.status === "draft") continue;
    if (e.cover_state !== "at_risk" && e.cover_state !== "no_cover") continue;
    if (Date.parse(e.ends_at) <= now.getTime()) continue;
    leadGapEvents.add(e.event_id);
    const g = gaps.get(e.event_id) ?? [];
    items.push({
      key: `lead-${e.event_id}`, tier: imminent(e.starts_at) ? "urgent" : "site_lead", venue: e.venue_name,
      eventId: e.event_id, eventTitle: e.title, startsAt: e.starts_at, endsAt: e.ends_at, duty: "Site lead",
      reason: g.length ? g.map((x) => `No confirmed site lead · ${formatRange(x.start, x.end)}`).join("; ")
        : e.cover_state === "no_cover" ? "No site lead arranged" : "Site lead not confirmed for the whole time",
      action: e.coverage_event_id
        ? { label: "Open venue cover", href: `/manage/events/${e.coverage_event_id}` }
        : { label: "Fix site cover", href: `/manage/events/${e.event_id}` },
    });
  }

  // Duties with open places (published/postponed events only; a draft is listed once as a draft).
  for (const s of shifts) {
    const ev = byId.get(s.event_id);
    if (!ev || ev.status === "draft" || !LIVE.has(ev.status) || s.open <= 0) continue;
    if (Date.parse(s.ends_at) <= now.getTime()) continue;
    if (s.duty_code === "site_lead" && leadGapEvents.has(s.event_id)) continue; // already listed above
    items.push({
      key: `open-${s.shift_id}`, tier: imminent(s.starts_at) ? "urgent" : "open", venue: s.venue_name,
      eventId: s.event_id, eventTitle: s.event_title, startsAt: s.starts_at, endsAt: s.ends_at, duty: s.duty_name,
      reason: `${plural(s.open, "place")} open (${s.confirmed} of ${s.required} confirmed${s.pending ? `, ${s.pending} awaiting approval` : ""})`,
      action: { label: "Find someone", href: `/manage/shifts/${s.shift_id}/assign` },
    });
  }

  // Requests from the action queue. Late cancellations are always shown; the rest within the range.
  let laterRequests = 0;
  for (const q of queue) {
    if (q.kind !== "cancellation" && !inRange(q.shift_starts_at, q.shift_ends_at)) { laterRequests++; continue; }
    const base = {
      venue: q.venue_name, eventId: q.event_id, eventTitle: q.event_title,
      startsAt: q.shift_starts_at, endsAt: q.shift_ends_at, duty: q.duty_name,
    };
    if (q.kind === "cancellation") {
      items.push({ ...base, key: `cancel-${q.request_id}`, tier: "urgent",
        reason: `${q.display_name} asked to cancel late${q.reason ? `: “${q.reason}”` : ""}. Still on the duty until you decide`,
        action: { label: "Review request", href: "/manage/approvals#cancellations" } });
    } else if (q.kind === "reconfirmation") {
      items.push({ ...base, key: `reconfirm-${q.assignment_id}`, tier: "reconfirm",
        reason: `${q.display_name} needs to reconfirm after a change. Not counted until they do`,
        action: { label: "Review request", href: "/manage/approvals#reconfirmations" } });
    } else if (q.kind === "approval") {
      items.push({ ...base, key: `approve-${q.assignment_id}`, tier: "approval",
        reason: `${q.display_name} asked to do this duty and needs your approval`,
        action: { label: "Review request", href: "/manage/approvals#approvals" } });
    } else {
      items.push({ ...base, key: `invite-${q.assignment_id}`, tier: "invitation",
        reason: `${q.display_name} hasn't answered an invitation. Not counted as cover`,
        action: { label: "Review request", href: "/manage/approvals#invitations" } });
    }
  }

  // Drafts in range: volunteers can't see them yet.
  for (const e of events) {
    if (e.status !== "draft" || Date.parse(e.ends_at) <= now.getTime()) continue;
    items.push({
      key: `draft-${e.event_id}`, tier: "draft", venue: e.venue_name, eventId: e.event_id, eventTitle: e.title,
      startsAt: e.starts_at, endsAt: e.ends_at, duty: null, reason: "Not published, so volunteers can't see or sign up yet",
      action: { label: "Open event", href: `/manage/events/${e.event_id}` },
    });
  }

  items.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key));
  return { items, laterRequests };
}

export type RangePreset = "today" | "7" | "28";
export const RANGE_DAYS: Record<RangePreset, number> = { today: 1, "7": 7, "28": 28 };
export const RANGE_LABEL: Record<RangePreset, string> = { today: "Today", "7": "Next 7 days", "28": "Next 28 days" };
/** Unknown or missing values fall back to the 28-day default (brief §2). */
export const parseRange = (v: unknown): RangePreset => (v === "today" || v === "7" || v === "28" ? v : "28");
