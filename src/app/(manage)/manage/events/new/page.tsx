import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Notice } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadCoverageEvents, loadManagedVenueIds, loadTeams, loadTemplates, loadVenues } from "@/lib/data/manage";
import { addDays, startOfLondonDay, todayKey } from "@/lib/time/london";
import { EventBuilder } from "./event-builder";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewEvent />
    </Suspense>
  );
}

async function NewEvent() {
  const me = await requireRole(MANAGER_ROLES);
  const today = todayKey();
  const [venues, managed, teams, templates, coverage] = await Promise.all([
    loadVenues(),
    loadManagedVenueIds(me.role === "admin", me.id),
    loadTeams(),
    loadTemplates(),
    loadCoverageEvents(startOfLondonDay(addDays(today, -1)), startOfLondonDay(addDays(today, 120))),
  ]);
  const usable = venues.filter((v) => v.active && (managed === "all" || managed.includes(v.id)));

  return (
    <section aria-labelledby="new-heading" className="space-y-4 pb-4">
      <h1 id="new-heading" className="text-2xl font-bold text-club">New event</h1>
      {usable.length === 0 ? (
        <Notice tone="warn" title="No venues to manage">Ask an administrator to give you access to a venue.</Notice>
      ) : (
        <EventBuilder venues={usable} teams={teams} templates={templates} coverageEvents={coverage} today={today} />
      )}
    </section>
  );
}
