import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Field, Input, LinkButton, Notice, StatusBadge } from "@/components/ui";
import { EventFields } from "@/components/hub/event-fields";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadTeams, loadVenues } from "@/lib/data/hub";
import { loadEvent } from "@/lib/data/hub-events";
import { eventTimeLabel } from "@/lib/domain/hub-calendar";
import { formatLongDay } from "@/lib/time/london";
import { copyHubEventAction, setHubEventStatusAction, updateHubEventAction } from "../hub-actions";

export const metadata: Metadata = { title: "Edit event" };

export default function ManageEventPage(props: PageProps<"/manage/events/[id]">) {
  return <Suspense fallback={<PageLoading />}><ManageEvent {...props} /></Suspense>;
}

async function ManageEvent({ params, searchParams }: PageProps<"/manage/events/[id]">) {
  await requireLevel(HUB_MANAGERS);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const [e, venues, teams] = await Promise.all([loadEvent(id), loadVenues(), loadTeams()]);
  if (!e) notFound();
  const closed = e.status === "cancelled" || e.status === "completed";
  return (
    <section aria-labelledby="h" className="mx-auto max-w-2xl space-y-4">
      <p><Link href={`/calendar/${e.id}`} className="text-sm font-semibold text-club-blue underline">← Event page</Link></p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">{e.title}</h1>
        <StatusBadge status={e.status} />
      </div>
      <p className="text-sm text-ink-muted">{formatLongDay(new Date(e.starts_at))} · {eventTimeLabel(e)}</p>
      {sp.created ? (
        <Notice tone="good" title={sp.created === "copy" ? "Copy saved as a draft" : "Event created"}>
          <p>Nothing has been sent. Optional next steps:</p>
          <ul className="mt-1 list-disc pl-5">
            {e.volunteers_enabled ? <li><Link className="text-club-blue underline" href={`/calendar/${e.id}#request`}>Request availability</Link></li> : null}
            <li><Link className="text-club-blue underline" href={`/calendar/${e.id}#invite`}>Invite a person to help</Link></li>
            {e.venue_id ? <li><Link className="text-club-blue underline" href={`/manage/venue-cover?date=${e.starts_at.slice(0, 10)}`}>Assign shared venue cover</Link></li> : null}
          </ul>
        </Notice>
      ) : null}
      {e.status === "cancelled" ? <Notice tone="bad" title="Cancelled">{e.cancel_reason}</Notice> : null}

      {!closed ? (
        <Card title="Details">
          <ActionForm action={updateHubEventAction} submitLabel="Save changes" trackChanges>
            <input type="hidden" name="event_id" value={e.id} />
            <EventFields e={e} venues={venues} teams={teams} />
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Status">
        <div className="flex flex-wrap gap-3">
          {e.status === "draft" ? (
            <ActionForm action={setHubEventStatusAction} submitLabel="Publish" className="">
              <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="published" />
            </ActionForm>
          ) : null}
          {e.status === "published" ? (
            <ActionForm action={setHubEventStatusAction} submitLabel="Unpublish (back to draft)" variant="secondary" className="">
              <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="draft" />
            </ActionForm>
          ) : null}
          {e.status === "published" && new Date(e.starts_at) < new Date() ? (
            <ActionForm action={setHubEventStatusAction} submitLabel="Mark completed" variant="secondary" className="">
              <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="completed" />
            </ActionForm>
          ) : null}
        </div>
        {!closed ? (
          <details className="mt-3 rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-danger">Cancel this event</summary>
            <ActionForm action={setHubEventStatusAction} submitLabel="Cancel event" variant="danger" confirm="Cancel this event? It stays on the calendar marked as cancelled.">
              <input type="hidden" name="event_id" value={e.id} /><input type="hidden" name="status" value="cancelled" />
              <Field label="Reason (shown on the event)"><Input name="reason" required maxLength={500} /></Field>
            </ActionForm>
          </details>
        ) : null}
      </Card>

      <Card title="Copy to another date">
        <p className="mb-2 text-sm text-ink-muted">Makes a new draft with the same details. Invitations, replies and venue cover are not copied.</p>
        <ActionForm action={copyHubEventAction} submitLabel="Copy as draft" variant="secondary">
          <input type="hidden" name="event_id" value={e.id} />
          <Field label="New date"><Input name="date" type="date" required /></Field>
        </ActionForm>
      </Card>
      <LinkButton href="/manage/events" variant="secondary">All events</LinkButton>
    </section>
  );
}
