/**
 * Who is involved with an event, as ONE card per person (spec 01 §9: no duplicate person cards).
 * Each person is placed in their strongest section; other involvement shows as extra badges.
 * Badges never imply more than is true: "Expected" and "Available" are never shown as confirmed.
 */
import { addDays, formatTime, londonParts, londonToInstant } from "@/lib/time/london";

export type Assignment = {
  id: string; person_id: string; name: string; label: string | null; begins_at: string | null; ends_at: string | null;
  state: "pending" | "confirmed" | "declined" | "cancelled" | "needs_reconfirmation"; response_source: "self" | "admin_recorded" | null;
  invitation_source: string; recorded_by?: string | null; cancel_reason?: string | null; email?: string | null; phone?: string | null;
};
export type Expected = { person_id: string; name: string; role: string; override: string | null; override_note?: string | null; email?: string | null; phone?: string | null };
export type Availability = {
  person_id: string; name: string; response: "yes" | "no"; for_full_event: boolean; available_from: string | null; available_until: string | null;
  needs_admin_check?: boolean | null; response_source: "self" | "admin_recorded"; recorded_by?: string | null; email?: string | null; phone?: string | null;
};
export type RequestRow = { person_id: string; name: string; requested_at: string; delivery_state: string; replied: boolean; email?: string | null; phone?: string | null };
export type VenueCover = { id: string; person_id: string; name: string; label: string | null; begins_at: string; ends_at: string; coverage: "full" | "partial" | "at_start_only" };
export type Involvement = { can_manage: boolean; assignments: Assignment[]; expected: Expected[]; availability: Availability[]; requests: RequestRow[]; venue_cover?: VenueCover[]; my_request: boolean };

export type Tone = "neutral" | "info" | "good" | "warn" | "bad";
export type Badge = { text: string; tone: Tone };
export type SectionKey = "confirmed" | "venue" | "expected" | "available" | "awaiting" | "declined";
export type PersonCard = { person_id: string; name: string; section: SectionKey; badges: Badge[]; detail: string[]; contact?: { email?: string | null; phone?: string | null }; assignment?: Assignment; expected?: Expected };

export const SECTION_TITLES: Record<SectionKey, string> = {
  confirmed: "Confirmed to help",
  venue: "Venue-wide cover",
  expected: "Expected by role",
  available: "Available to help",
  awaiting: "Awaiting response",
  declined: "Declined or can't help",
};
const ORDER: SectionKey[] = ["confirmed", "venue", "expected", "available", "awaiting", "declined"];

const range = (a: string | null, b: string | null) => (a && b ? `${formatTime(new Date(a))}–${formatTime(new Date(b))}` : a ? `from ${formatTime(new Date(a))}` : "");

export function availabilityText(a: Pick<Availability, "response" | "for_full_event" | "available_from" | "available_until">, eventEndKnown: boolean): string {
  if (a.response === "no") return "Can't help";
  if (a.for_full_event) return eventEndKnown ? "Available for the whole event" : "Available for the whole event (finish not recorded)";
  return `Available ${range(a.available_from, a.available_until)}`;
}

export function assignmentBadge(a: Assignment): Badge {
  switch (a.state) {
    case "confirmed": return { text: a.response_source === "admin_recorded" ? "Confirmed — recorded by organiser" : "Confirmed", tone: "good" };
    case "pending": return { text: "Invited — awaiting reply", tone: "warn" };
    case "needs_reconfirmation": return { text: "Needs to reconfirm", tone: "warn" };
    case "declined": return { text: "Declined", tone: "neutral" };
    case "cancelled": return { text: "Cancelled", tone: "neutral" };
  }
}

export function buildCards(inv: Involvement, eventEndKnown: boolean): { section: SectionKey; title: string; cards: PersonCard[] }[] {
  const cards = new Map<string, PersonCard>();
  const rank = (s: SectionKey) => ORDER.indexOf(s);
  const touch = (id: string, name: string, section: SectionKey, contact?: { email?: string | null; phone?: string | null }) => {
    const c = cards.get(id) ?? { person_id: id, name, section, badges: [], detail: [], contact };
    if (rank(section) < rank(c.section)) c.section = section;
    if (contact && (contact.email || contact.phone)) c.contact = contact;
    cards.set(id, c);
    return c;
  };
  for (const a of inv.assignments.filter((x) => x.state !== "cancelled")) {
    const section: SectionKey = a.state === "confirmed" ? "confirmed" : a.state === "declined" ? "declined" : "awaiting";
    const c = touch(a.person_id, a.name, section, { email: a.email, phone: a.phone });
    c.badges.push(assignmentBadge(a));
    c.detail.push([a.label, range(a.begins_at, a.ends_at)].filter(Boolean).join(" · "));
    if (!c.assignment || section === "confirmed") c.assignment = a;
  }
  for (const v of inv.venue_cover ?? []) {
    const c = touch(v.person_id, v.name, "venue");
    c.badges.push({ text: v.coverage === "full" ? "Venue cover — whole event" : v.coverage === "partial" ? "Venue cover — part of event" : "Venue cover at kick-off", tone: "good" });
    c.detail.push([v.label, range(v.begins_at, v.ends_at)].filter(Boolean).join(" · "));
  }
  for (const e of inv.expected) {
    const absent = e.override === "not_expected";
    const c = touch(e.person_id, e.name, absent ? "declined" : "expected", { email: e.email, phone: e.phone });
    c.expected = e;
    c.badges.push(absent ? { text: "Not expected this time", tone: "neutral" }
      : e.override === "confirmed_by_admin" ? { text: `${e.role} — attendance confirmed by organiser`, tone: "good" }
      : { text: `${e.role} — expected, not confirmed`, tone: "neutral" });
  }
  for (const a of inv.availability) {
    const c = touch(a.person_id, a.name, a.response === "yes" ? "available" : "declined", { email: a.email, phone: a.phone });
    c.badges.push({ text: a.response === "yes" ? "Said they can help" : "Can't help", tone: a.response === "yes" ? "info" : "neutral" });
    if (a.response_source === "admin_recorded") c.badges.push({ text: `Recorded by ${a.recorded_by ?? "organiser"}`, tone: "neutral" });
    if (a.needs_admin_check) c.badges.push({ text: "Check times (finish not recorded)", tone: "warn" });
    c.detail.push(availabilityText(a, eventEndKnown));
  }
  for (const r of inv.requests.filter((x) => !x.replied)) {
    const c = touch(r.person_id, r.name, "awaiting", { email: r.email, phone: r.phone });
    c.badges.push({ text: r.delivery_state === "failed" ? "Asked — message not sent" : r.delivery_state === "manual_contact" ? "Asked in person — not replied" : "Asked — not replied", tone: r.delivery_state === "failed" ? "bad" : "warn" });
  }
  const out = ORDER.map((s) => ({ section: s, title: SECTION_TITLES[s], cards: [...cards.values()].filter((c) => c.section === s).sort((a, b) => a.name.localeCompare(b.name)) }));
  return out.filter((s) => s.cards.length > 0);
}

/** Unique people by status for summaries (counts each person once, in their strongest status). */
export function headcount(inv: Involvement, eventEndKnown: boolean) {
  const sections = buildCards(inv, eventEndKnown);
  const n = (k: SectionKey) => sections.find((s) => s.section === k)?.cards.length ?? 0;
  return { confirmed: n("confirmed"), venue: n("venue"), expected: n("expected"), available: n("available"), awaiting: n("awaiting"), declined: n("declined") };
}

/** "HH:MM" times on the event's UK day (a time before the event's start time means the next day). */
export function timesOnEventDay(eventStartIso: string, from: string, until: string): { ok: true; from: Date; until: Date } | { ok: false; error: string } {
  const day = londonParts(new Date(eventStartIso)).dateKey;
  const f = londonToInstant(day, from);
  const untilDay = until <= from ? addDays(day, 1) : day;
  const u = londonToInstant(untilDay, until);
  if (!f.ok || !u.ok) return { ok: false, error: "Enter valid times (hh:mm)." };
  return { ok: true, from: f.instant, until: u.instant };
}
