import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { HubEventCard } from "@/components/hub/event-card";
import { Card, LinkButton } from "@/components/ui";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { groupByDayAndPlace } from "@/lib/domain/hub-calendar";
import { loadEventsBetween, loadNames, placeName } from "@/lib/data/hub-events";
import { addDays, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Events" };

export default function ManageEventsPage() {
  return <Suspense fallback={<PageLoading />}><ManageEvents /></Suspense>;
}

async function ManageEvents() {
  await requireLevel(HUB_MANAGERS);
  const today = todayKey();
  const [events, names] = await Promise.all([loadEventsBetween(startOfLondonDay(today), startOfLondonDay(addDays(today, 56))), loadNames()]);
  const drafts = events.filter((e) => e.status === "draft");
  const groups = groupByDayAndPlace(events.filter((e) => e.status !== "draft"), (e) => placeName(e, names));
  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">Events</h1>
        <LinkButton href="/manage/events/new">+ Event</LinkButton>
      </div>
      {drafts.length ? (
        <Card title={`Drafts (${drafts.length})`}>
          <div className="space-y-2">{drafts.map((e) => <HubEventCard key={e.id} e={e} href={`/manage/events/${e.id}`} place={placeName(e, names)} team={e.team_id ? names.teams.get(e.team_id) : undefined} />)}</div>
        </Card>
      ) : null}
      <h2 className="text-lg font-bold text-club">Next 8 weeks</h2>
      {groups.length === 0 ? <Card><p>No upcoming events.</p></Card> : groups.map((g) => (
        <section key={g.day} aria-label={g.label} className="space-y-2">
          <h3 className="font-bold text-club">{g.label}</h3>
          {g.places.map((p) => (
            <div key={p.place} className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{p.place}</p>
              {p.events.map((e) => <HubEventCard key={e.id} e={e} href={`/manage/events/${e.id}`} team={e.team_id ? names.teams.get(e.team_id) : undefined} />)}
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}
