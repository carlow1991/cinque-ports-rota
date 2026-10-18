import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Notice, StatusBadge } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { loadEvent, loadNames, placeName } from "@/lib/data/hub-events";
import { categoryLabel, eventTimeLabel } from "@/lib/domain/hub-calendar";
import { formatLongDay } from "@/lib/time/london";

export const metadata: Metadata = { title: "Event" };

export default function EventPage(props: PageProps<"/calendar/[id]">) {
  return <Suspense fallback={<PageLoading />}><EventDetail {...props} /></Suspense>;
}

async function EventDetail({ params }: PageProps<"/calendar/[id]">) {
  const me = await requirePerson();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [e, names] = await Promise.all([loadEvent(id), loadNames()]);
  if (!e) notFound(); // RLS: drafts outside your scope simply don't exist for you
  const isManager = me.level !== "member";
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
      {e.description ? <Card><p className="whitespace-pre-line text-sm">{e.description}</p></Card> : null}
      {!e.volunteers_enabled ? <p className="text-sm text-ink-muted">For information — volunteers aren&apos;t being asked for this event.</p> : null}
      {isManager ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/manage/events/${e.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Edit, copy or cancel</Link>
        </div>
      ) : null}
    </section>
  );
}
