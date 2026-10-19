/**
 * Email content for every outbox message kind. Pure functions: no I/O, easy to test.
 *
 * Privacy rules (spec): an email only ever describes the recipient's OWN duty, or (for organisers)
 * an event-level alert. No roster, no other volunteer's name, email or phone, ever. The payloads
 * built in the database contain nothing else, and these templates add nothing else.
 * Times are shown in UK time with GMT/BST. All values are HTML-escaped.
 */
import { formatLongDay, formatRange, formatTime, zoneLabel } from "@/lib/time/london";

export type EmailPayload = Record<string, unknown>;
export type RenderedEmail = { subject: string; text: string; html: string };

const CLUB = "Cinque Ports FC";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** Strip line breaks so nothing user-entered can inject extra header-like lines into a subject. */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

function when(p: EmailPayload): string | null {
  const s = new Date(str(p.shift_starts_at) || str(p.starts_at));
  if (Number.isNaN(s.getTime())) return null;
  const e = new Date(str(p.shift_ends_at));
  const day = formatLongDay(s);
  if (Number.isNaN(e.getTime())) return `${day}, ${formatTime(s)} ${zoneLabel(s)}`;
  return `${day}, ${formatRange(s, e)} ${zoneLabel(s)}`;
}

type Spec = {
  subject: (d: Details) => string;
  intro: (d: Details) => string;
  /** Optional extra paragraph (e.g. the organiser's reason). */
  extra?: (d: Details) => string | null;
  action?: { label: string; path: (p: EmailPayload) => string };
  audience: "volunteer" | "organiser";
};

type Details = { duty: string; event: string; venue: string; when: string | null; reason: string; person: string };

const myDuties = { label: "Open My duties", path: () => "/my-duties" };
const eventPage = (label: string) => ({ label, path: (p: EmailPayload) => (isUuid(p.event_id) ? `/rota/${p.event_id}` : "/rota") });
const reasonPara = (prefix: string) => (d: Details) => (d.reason ? `${prefix}: ${d.reason}` : null);

const SPECS: Record<string, Spec> = {
  signup_confirmed: { audience: "volunteer", subject: (d) => `You're confirmed: ${d.duty}, ${d.event}`,
    intro: (d) => `Thank you for volunteering. You're confirmed for ${d.duty} at ${d.event}.`, action: myDuties },
  signup_pending: { audience: "volunteer", subject: (d) => `Request received: ${d.duty}, ${d.event}`,
    intro: (d) => `Thanks. Your request for ${d.duty} at ${d.event} has been sent to an organiser for approval. Your place is held meanwhile, and we'll email you when it's decided.`, action: myDuties },
  invitation_accepted: { audience: "volunteer", subject: (d) => `You're confirmed: ${d.duty}, ${d.event}`,
    intro: (d) => `Thanks for accepting. You're confirmed for ${d.duty} at ${d.event}.`, action: myDuties },
  approval_confirmed: { audience: "volunteer", subject: (d) => `Approved: ${d.duty}, ${d.event}`,
    intro: (d) => `Good news: an organiser has approved you for ${d.duty} at ${d.event}. You're confirmed.`, action: myDuties },
  approval_declined: { audience: "volunteer", subject: (d) => `Not needed this time: ${d.duty}, ${d.event}`,
    intro: (d) => `Thank you for offering to help with ${d.duty} at ${d.event}. An organiser wasn't able to approve it this time. Other duties may still need people.`,
    action: { label: "See the rota", path: () => "/rota" } },
  duty_invitation: { audience: "volunteer", subject: (d) => `Can you help? ${d.duty}, ${d.event}`,
    intro: (d) => `An organiser has invited you to help with ${d.duty} at ${d.event}. Please accept or decline in the app. No place is held until you accept.`, action: myDuties },
  withdrawal_confirmed: { audience: "volunteer", subject: (d) => `You've been taken off: ${d.duty}, ${d.event}`,
    intro: (d) => `This confirms you're no longer down for ${d.duty} at ${d.event}. Thanks for letting us know in good time.`,
    action: { label: "See the rota", path: () => "/rota" } },
  assignment_removed: { audience: "volunteer", subject: (d) => `Change to your duty: ${d.duty}, ${d.event}`,
    intro: (d) => `An organiser has taken you off ${d.duty} at ${d.event}. You don't need to attend this duty.`,
    extra: reasonPara("Reason given"), action: myDuties },
  cancellation_approved: { audience: "volunteer", subject: (d) => `Cancellation approved: ${d.duty}, ${d.event}`,
    intro: (d) => `An organiser has approved your request. You're no longer down for ${d.duty} at ${d.event}.`, action: myDuties },
  cancellation_declined: { audience: "volunteer", subject: (d) => `Still needed: ${d.duty}, ${d.event}`,
    intro: (d) => `An organiser couldn't release you from ${d.duty} at ${d.event}, so you're still down for it. If you can't make it, please speak to the organiser directly.`, action: myDuties },
  event_cancelled: { audience: "volunteer", subject: (d) => `Cancelled: ${d.event}`,
    intro: (d) => `${d.event} has been cancelled, so your ${d.duty} duty won't go ahead. Thank you for being ready to help.`,
    extra: reasonPara("Reason given"), action: myDuties },
  event_postponed: { audience: "volunteer", subject: (d) => `Postponed: ${d.event}`,
    intro: (d) => `${d.event} has been postponed. Your ${d.duty} duty is on hold, and we'll let you know when a new date is set.`,
    extra: reasonPara("Reason given"), action: myDuties },
  reconfirm_needed: { audience: "volunteer", subject: (d) => `Please reconfirm: ${d.duty}, ${d.event}`,
    intro: (d) => `The time of ${d.duty} at ${d.event} has changed. Please check the new time below and accept or decline in the app.`, action: myDuties },
  shift_cancelled: { audience: "volunteer", subject: (d) => `Duty cancelled: ${d.duty}, ${d.event}`,
    intro: (d) => `${d.duty} at ${d.event} is no longer needed, so you don't need to attend. Thank you.`,
    extra: reasonPara("Reason given"), action: myDuties },
  reminder: { audience: "volunteer", subject: (d) => `Tomorrow: ${d.duty}, ${d.event}`,
    intro: (d) => `A quick reminder that you're down for ${d.duty} at ${d.event} tomorrow. Thank you for helping.`,
    action: eventPage("Open the duty details") },
  cancellation_requested: { audience: "organiser", subject: (d) => `Cancellation request: ${d.duty}, ${d.event}`,
    intro: (d) => `A volunteer has asked to be released from ${d.duty} at ${d.event}. They stay on the duty until you decide.`,
    action: { label: "Review in Needs action", path: () => "/manage/approvals" } },
  // ---- Volunteer Hub (sent only after a deliberate action; never for creating people or events) ----
  availability_request: { audience: "volunteer", subject: (d) => `Can you help? ${d.event}`,
    intro: (d) => `The club is asking who could help at ${d.event}. Please answer Yes or No in the Volunteer Hub. Saying yes isn't a booking — an organiser will confirm with you.`,
    action: { label: "Answer in the Hub", path: (p) => (isUuid(p.event_id) ? `/calendar/${p.event_id}` : "/home") } },
  assignment_request: { audience: "volunteer", subject: (d) => `Can you help with ${d.duty}? ${d.event}`,
    intro: (d) => `An organiser has asked if you can help with ${d.duty} at ${d.event}. Please accept or decline in the Volunteer Hub. You're not booked until you accept.`,
    action: { label: "Accept or decline", path: () => "/home" } },
  venue_cover_request: { audience: "volunteer", subject: (d) => `Can you cover ${d.duty}? ${d.venue}`,
    intro: (d) => `An organiser has asked if you can cover ${d.duty} at ${d.venue}. Please accept or decline in the Volunteer Hub.`,
    action: { label: "Accept or decline", path: () => "/home" } },
  assignment_reconfirm: { audience: "volunteer", subject: (d) => `Please reconfirm: ${d.duty}, ${d.event}`,
    intro: (d) => `The date, time or place of ${d.duty} at ${d.event} has changed. Please check the details below and accept or decline again in the Volunteer Hub.`,
    action: { label: "Reconfirm", path: () => "/home" } },
  assignment_cancelled: { audience: "volunteer", subject: (d) => `No longer needed: ${d.duty}, ${d.event}`,
    intro: (d) => `An organiser has cancelled your ${d.duty} at ${d.event}, so you don't need to attend. Thank you for being ready to help.`,
    extra: reasonPara("Reason given"), action: { label: "Open the Hub", path: () => "/home" } },
  hub_event_cancelled: { audience: "volunteer", subject: (d) => `Cancelled: ${d.event}`,
    intro: (d) => `${d.event} has been cancelled, so your ${d.duty} won't go ahead. Thank you for being ready to help.`,
    action: { label: "Open the Hub", path: () => "/home" } },
  hub_reminder: { audience: "volunteer", subject: (d) => `Tomorrow: ${d.duty}, ${d.event}`,
    intro: (d) => `A quick reminder that you're helping with ${d.duty} at ${d.event} tomorrow. Thank you!`,
    action: { label: "See the details", path: (p) => (isUuid(p.event_id) ? `/calendar/${p.event_id}` : "/home") } },
  assignment_confirmed: { audience: "organiser", subject: (d) => `${d.person} accepted: ${d.duty}, ${d.event}`,
    intro: (d) => `${d.person} has accepted your request to help with ${d.duty} at ${d.event}.`,
    action: { label: "Open the event", path: (p) => (isUuid(p.event_id) ? `/calendar/${p.event_id}` : "/manage/requests") } },
  assignment_declined: { audience: "organiser", subject: (d) => `${d.person} can't help: ${d.duty}, ${d.event}`,
    intro: (d) => `${d.person} has declined your request to help with ${d.duty} at ${d.event}. You may want to ask someone else.`,
    action: { label: "Open the event", path: (p) => (isUuid(p.event_id) ? `/calendar/${p.event_id}` : "/manage/requests") } },
  assignment_withdrawn: { audience: "organiser", subject: (d) => `${d.person} can no longer help: ${d.duty}, ${d.event}`,
    intro: (d) => `${d.person} has let you know they can no longer help with ${d.duty} at ${d.event}.`,
    action: { label: "Open the event", path: (p) => (isUuid(p.event_id) ? `/calendar/${p.event_id}` : "/manage/requests") } },
  venue_cover_at_risk: { audience: "organiser", subject: (d) => `Check site cover: ${d.event}`,
    intro: (d) => `The venue-wide site lead that ${d.event} relies on is no longer confirmed. Please check the event's site cover before it goes ahead.`,
    action: { label: "Open the event", path: (p) => (isUuid(p.event_id) ? `/manage/events/${p.event_id}` : "/manage/coverage") } },
};

export const EMAIL_KINDS = Object.keys(SPECS);

/** Returns null for an unknown kind (the worker suppresses it rather than sending something odd). */
export function renderEmail(kind: string, payload: EmailPayload, opts: { recipientName?: string | null; siteUrl: string }): RenderedEmail | null {
  const spec = SPECS[kind];
  if (!spec) return null;
  const reasonRaw = kind === "assignment_removed" ? str(payload.removal_reason)
    : kind === "assignment_cancelled" ? str(payload.reason) : str(payload.event_status_reason);
  const d: Details = {
    duty: oneLine(str(payload.duty)) || "your duty",
    event: oneLine(str(payload.event_title)) || "the event",
    venue: oneLine(str(payload.venue)),
    when: when(payload),
    reason: oneLine(reasonRaw).slice(0, 300),
    person: oneLine(str(payload.person_name)) || "A volunteer",
  };
  const first = oneLine(str(opts.recipientName)).split(" ")[0];
  const greeting = first ? `Hi ${first},` : "Hello,";
  const subject = oneLine(spec.subject(d)).slice(0, 150);
  const lines: [string, string][] = [];
  if ((spec.audience === "volunteer" || kind === "cancellation_requested" || kind.startsWith("assignment_")) && kind !== "availability_request") lines.push([kind.startsWith("assignment_") || kind.startsWith("hub_") || kind === "venue_cover_request" ? "Helping with" : "Duty", d.duty]);
  lines.push(["Event", d.event]);
  if (d.venue) lines.push(["Venue", d.venue]);
  if (d.when) lines.push(["When", d.when]);
  const extra = spec.extra?.(d) ?? null;
  const base = opts.siteUrl.replace(/\/+$/, "");
  const link = spec.action ? { label: spec.action.label, url: `${base}${spec.action.path(payload)}` } : null;
  const footer = spec.audience === "organiser"
    ? `You're receiving this because you organise duties at ${CLUB}.`
    : `You're receiving this because you volunteer with ${CLUB}. Questions? Please contact your duty organiser.`;

  const text = [greeting, "", spec.intro(d), "", ...lines.map(([k, v]) => `${k}: ${v}`),
    ...(extra ? ["", extra] : []), ...(link ? ["", `${link.label}: ${link.url}`] : []), "", "—", footer].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html><html lang="en-GB"><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#1b2533">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#2a426f;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">${e(CLUB)} volunteers</td></tr>
<tr><td style="padding:24px;font-size:16px;line-height:1.5">
<p style="margin:0 0 12px">${e(greeting)}</p>
<p style="margin:0 0 16px">${e(spec.intro(d))}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;font-size:15px">
${lines.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#566176;vertical-align:top">${e(k)}</td><td style="padding:2px 0;font-weight:bold">${e(v)}</td></tr>`).join("\n")}
</table>
${extra ? `<p style="margin:0 0 16px">${e(extra)}</p>` : ""}
${link ? `<p style="margin:0 0 8px"><a href="${e(link.url)}" style="display:inline-block;background:#0038c1;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold">${e(link.label)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;border-top:3px solid #f25c05;font-size:13px;color:#566176">${e(footer)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}
