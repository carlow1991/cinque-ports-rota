import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Notice, StatusBadge } from "@/components/ui";
import { HelpResponse } from "@/components/hub/help-response";
import { InvolvementSections } from "@/components/hub/involvement-sections";
import { InvitePanel, RecordReplyPanel, RequestAvailabilityPanel } from "@/components/hub/organiser-panels";
import { requirePerson } from "@/lib/auth/dal";
import { loadEvent, loadNames, placeName } from "@/lib/data/hub-events";
import { loadCandidates, loadInvolvement, loadPicker } from "@/lib/data/hub-involvement";
import { categoryLabel, eventTimeLabel } from "@/lib/domain/hub-calendar";
import { assignmentBadge, availabilityText } from "@/lib/domain/involvement";
import { formatLongDay, formatTime } from "@/lib/time/london";
import { respondAssignmentAction, respondAvailabilityAction, withdrawAssignmentAction } from "../actions";

export const metadata: Metadata = { title: "Event" };

export default function EventPage(props: PageProps<"/calendar/[id]">) {
  return <Suspense fallback={<PageLoading />}><EventDetail {...props} /></Suspense>;
}

async function EventDetail({ params }: PageProps<"/calendar/[id]">) {
  const me = await requirePerson();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [e, names] = await Promise.all([loadEvent(id), loadNames()]);
  if (!e) notFound(); // RLS: drafts outside your scope don't exist for you
  const inv = await loadInvolvement(id);
  const manage = inv.can_manage;
  const [candidates, picker] = manage ? await Promise.all([e.volunteers_enabled ? loadCandidates(id) : Promise.resolve([]), loadPicker()]) : [[], []];
  const open = (e.status === "published" || e.status === "postponed") && new Date(e.ends_at ?? Date.parse(e.starts_at) + 6 * 3600_000) > new Date();
  const mine = inv.availability.find((a) => a.person_id === me.id);
  const myAssignments = inv.assignments.filter((a) => a.person_id === me.id && a.state !== "cancelled");
  const endKnown = Boolean(e.ends_at);

  return (
    <section aria-labelledby="h" className="space-y-4">
      <p><Link href="/calendar" className="text-sm font-semibold text-club-blue underline">← Calendar</Link></p>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 id="h" className="text-2xl font-bold text-club">{e.title}</h1>
          {e.status !== "published" ? <StatusBadge status={e.status} /> : null}
          {e.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
        </div>
        <p className="font-semibold">{formatLongDay(new Date(e.starts_at))} · {eventTimeLabel(e)}</p>
        <p className="text-sm text-ink-muted">{[categoryLabel(e.category), e.team_id ? names.teams.get(e.team_id) : null, placeName(e, names),
          e.opponent ? `v ${e.opponent}` : null, e.competition].filter(Boolean).join(" · ")}</p>
      </header>
      {e.status === "cancelled" ? <Notice tone="bad" title="Cancelled">{e.cancel_reason}</Notice> : null}

      {myAssignments.map((a) => (
        <Card key={a.id} title={a.state === "confirmed" ? "You're helping" : a.state === "declined" ? "You declined" : a.state === "needs_reconfirmation" ? "Please reconfirm — the event changed" : "You've been asked to help"}>
          <p className="text-sm">{[a.label, a.begins_at && a.ends_at ? `${formatTime(new Date(a.begins_at))}–${formatTime(new Date(a.ends_at))}` : null].filter(Boolean).join(" · ") || "General help"}</p>
          <p className="mt-1"><Badge tone={assignmentBadge(a).tone}>{assignmentBadge(a).text}</Badge></p>
          {open && (a.state === "pending" || a.state === "needs_reconfirmation") ? (
            <div className="mt-3 flex flex-wrap gap-3">
              <ActionForm action={respondAssignmentAction} submitLabel="Accept" className="" submitAriaLabel={`Accept: ${a.label ?? "help"} at ${e.title}`}>
                <input type="hidden" name="assignment_id" value={a.id} /><input type="hidden" name="accept" value="yes" />
              </ActionForm>
              <ActionForm action={respondAssignmentAction} submitLabel="Decline" variant="secondary" className="" submitAriaLabel={`Decline: ${a.label ?? "help"} at ${e.title}`}>
                <input type="hidden" name="assignment_id" value={a.id} /><input type="hidden" name="accept" value="no" />
              </ActionForm>
            </div>
          ) : null}
          {open && a.state === "confirmed" ? (
            <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">I can no longer do this</summary>
              <ActionForm action={withdrawAssignmentAction} submitLabel="Let the organiser know" variant="danger" confirm="Tell the organiser you can no longer help?">
                <input type="hidden" name="assignment_id" value={a.id} />
              </ActionForm>
            </details>
          ) : null}
        </Card>
      ))}

      {e.volunteers_enabled && open ? (
        <HelpResponse action={respondAvailabilityAction} eventId={e.id} current={mine?.response ?? null}
          currentText={mine ? availabilityText(mine, endKnown) : undefined} endKnown={endKnown} />
      ) : !e.volunteers_enabled ? <p className="text-sm text-ink-muted">For information — volunteers aren&apos;t being asked for this event.</p> : null}

      {e.description ? <Card><p className="whitespace-pre-line text-sm">{e.description}</p></Card> : null}

      <InvolvementSections inv={inv} eventId={e.id} endKnown={endKnown} manage={manage} />

      {manage && e.status !== "cancelled" && e.status !== "completed" ? (
        <div className="space-y-3 border-t border-line pt-4">
          <h2 className="text-lg font-semibold text-club">Organise</h2>
          {e.volunteers_enabled && e.status === "published" ? <RequestAvailabilityPanel eventId={e.id} candidates={candidates} open={false} /> : null}
          {e.volunteers_enabled && e.status !== "published" ? <p className="text-sm text-ink-muted">Publish the event to request availability.</p> : null}
          <InvitePanel eventId={e.id} people={picker} canRequest={e.status === "published"} />
          {e.volunteers_enabled ? <RecordReplyPanel eventId={e.id} people={picker} /> : null}
          <Link href={`/manage/events/${e.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Edit, copy or cancel</Link>
        </div>
      ) : null}
    </section>
  );
}
