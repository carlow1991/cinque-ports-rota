import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, DemoBadge, EVENT_TYPE_LABEL, Notice } from "@/components/ui";
import { requireVolunteer } from "@/lib/auth/dal";
import { loadVolunteerEvent, type VolunteerShift } from "@/lib/data/volunteer";
import { formatDuration } from "@/lib/domain/duty-time";
import { formatLongDay, formatRange, formatTime, zoneLabel } from "@/lib/time/london";
import { acceptAction, declineAction, signUpAction } from "../../actions";

export const metadata: Metadata = { title: "Event" };

export default function VolunteerEventPage({ params }: PageProps<"/rota/[eventId]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EventView params={params} />
    </Suspense>
  );
}

async function EventView({ params }: { params: PageProps<"/rota/[eventId]">["params"] }) {
  await requireVolunteer();
  const { eventId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) notFound();
  const data = await loadVolunteerEvent(eventId);
  if (!data) notFound();
  const { event: e, venue, teamName, shifts, roster } = data;
  const starts = new Date(e.starts_at);
  const ends = new Date(e.ends_at);
  const namesByShift = new Map<string, string[]>();
  for (const r of roster) namesByShift.set(r.shift_id, [...(namesByShift.get(r.shift_id) ?? []), r.display_name]);

  return (
    <article className="space-y-4">
      <p><Link href="/rota" className="text-sm font-semibold text-club-blue underline">← Back to the rota</Link></p>
      <header className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <Badge>{EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}</Badge>
          <DemoBadge show={e.is_demo} />
        </div>
        <h1 className="text-2xl font-bold text-club">{e.title}</h1>
        <p>{formatLongDay(starts)}</p>
        <p>
          <span className="text-ink-muted">Event</span> {formatRange(starts, ends)} {zoneLabel(starts)}
          {e.kickoff_at ? <> · <span className="text-ink-muted">Kick-off</span> {formatTime(new Date(e.kickoff_at))}</> : null}
        </p>
        <p className="text-sm text-ink-muted">Each duty below has its own arrive and finish times.</p>
        <p className="text-ink-muted">
          {venue?.name}{teamName ? ` · ${teamName}` : ""}{e.opponent ? ` · v ${e.opponent}` : ""}{e.competition ? ` · ${e.competition}` : ""}
        </p>
        {venue?.address ? <p className="text-sm text-ink-muted">{venue.address}</p> : null}
      </header>

      {e.status === "cancelled" ? <Notice tone="bad" title="This event has been cancelled">{e.status_reason ?? "Sorry, it's no longer going ahead."}</Notice> : null}
      {e.status === "postponed" ? <Notice tone="warn" title="This event has been postponed">{e.status_reason ?? "New details will follow."}</Notice> : null}
      {e.description ? <p className="whitespace-pre-line">{e.description}</p> : null}
      {e.instructions ? <Notice tone="info" title="Information for volunteers"><p className="whitespace-pre-line">{e.instructions}</p></Notice> : null}

      <section aria-labelledby="duties-h" className="space-y-3">
        <h2 id="duties-h" className="text-lg font-semibold text-club">Duties</h2>
        {shifts.length === 0 ? <p className="text-ink-muted">No volunteer duties for this event.</p> : null}
        {shifts.map((s) => <DutyCard key={s.shift_id} s={s} names={namesByShift.get(s.shift_id) ?? []} open={e.status === "published"} day={formatLongDay(new Date(s.starts_at))} />)}
      </section>

      <p className="text-xs text-ink-muted">
        Only first names/display names of confirmed volunteers are shown, and only to people on the same event. Contact details are never shown.
      </p>
    </article>
  );
}

function DutyCard({ s, names, open, day }: { s: VolunteerShift; names: string[]; open: boolean; day: string }) {
  const st = new Date(s.starts_at);
  const en = new Date(s.ends_at);
  return (
    <div id={`shift-${s.shift_id}`} className="scroll-mt-20 rounded-xl border border-line bg-white p-3 target:border-2 target:border-club">
      <h3 className="font-semibold">{s.duty_name}</h3>
      <p className="text-sm">
        <strong>Arrive {formatTime(st)}</strong> · Finish {formatTime(en)} <span className="text-ink-muted">({formatDuration(st, en)})</span>
      </p>
      {s.responsibilities.length ? <p className="text-sm text-ink-muted">Includes: {s.responsibilities.join(", ")}</p> : null}
      {s.instructions ? <p className="mt-1 whitespace-pre-line text-sm">{s.instructions}</p> : null}
      <p className="mt-1 text-sm">
        {s.confirmed_count} of {s.required_count} confirmed
        {s.pending_count ? ` · ${s.pending_count} awaiting approval` : ""}
        {s.open_slots ? ` · ${s.open_slots} ${s.open_slots === 1 ? "place" : "places"} left` : " · full"}
      </p>
      {names.length ? <p className="text-sm text-ink-muted">Going: {names.join(", ")}</p> : null}
      <div className="mt-2"><DutyAction s={s} open={open} day={day} /></div>
    </div>
  );
}

function DutyAction({ s, open, day }: { s: VolunteerShift; open: boolean; day: string }) {
  if (s.my_status === "confirmed")
    return <p className="font-semibold text-ok">✓ You&apos;re confirmed. <Link href="/my-duties" className="font-normal text-club-blue underline">Manage in My Duties</Link></p>;
  if (s.my_status === "pending_approval")
    return <p className="font-semibold text-club-blue">⏳ Awaiting organiser approval. Your place is held.</p>;
  if (s.my_status === "invited")
    return (
      <div className="space-y-2">
        <p className="font-semibold">You&apos;ve been invited to this duty.</p>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={acceptAction} submitLabel="Accept" pendingLabel="Accepting…" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="assignment_id" value={s.my_assignment_id ?? ""} />
          </ActionForm>
          <ActionForm action={declineAction} submitLabel="Decline" pendingLabel="Declining…" variant="secondary" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="assignment_id" value={s.my_assignment_id ?? ""} />
          </ActionForm>
        </div>
      </div>
    );
  if (!open) return <p className="text-sm text-ink-muted">Not open for sign-up.</p>;
  if (s.has_started) return <p className="text-sm text-ink-muted">This duty has started.</p>;
  if (!s.signup_enabled) return <p className="text-sm text-ink-muted">The organiser fills this duty. Ask them if you can help.</p>;
  if (s.open_slots === 0) return <p className="text-sm text-ink-muted">Full. Ask an organiser if more help is needed.</p>;
  if (s.missing_authorisations.length)
    return <p className="text-sm text-ink-muted">🔒 Needs a club authorisation for: {s.missing_authorisations.join(", ")}. Speak to an organiser if you think you should have it.</p>;
  if (s.has_overlap) return <p className="text-sm text-ink-muted">You already have a duty at this time.</p>;
  return (
    <ActionForm action={signUpAction} submitLabel={s.approval_required ? "Request this duty" : "Take this duty"} pendingLabel="Saving…"
      submitAriaLabel={`${s.approval_required ? "Request this duty" : "Take this duty"}: ${s.duty_name}, ${day}, ${formatTime(new Date(s.starts_at))} to ${formatTime(new Date(s.ends_at))}`}
      className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="shift_id" value={s.shift_id} />
      {s.approval_required ? <span className="w-full text-xs text-ink-muted">An organiser approves this duty. Your place is held while they decide.</span> : null}
    </ActionForm>
  );
}
