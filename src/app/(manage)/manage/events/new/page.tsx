import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card } from "@/components/ui";
import { EventFields } from "@/components/hub/event-fields";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadTeams, loadVenues } from "@/lib/data/hub";
import { isDateKey } from "@/lib/time/london";
import { createHubEventAction } from "../hub-actions";

export const metadata: Metadata = { title: "New event" };

export default function NewEventPage(props: PageProps<"/manage/events/new">) {
  return <Suspense fallback={<PageLoading />}><NewEvent {...props} /></Suspense>;
}

async function NewEvent({ searchParams }: PageProps<"/manage/events/new">) {
  await requireLevel(HUB_MANAGERS);
  const sp = await searchParams;
  const date = typeof sp.date === "string" && isDateKey(sp.date) ? sp.date : undefined;
  const [venues, teams] = await Promise.all([loadVenues(), loadTeams()]);
  return (
    <section aria-labelledby="h" className="mx-auto max-w-2xl space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">New event</h1>
      <p className="text-sm text-ink-muted">Add any club activity: matches, training, meetings, socials — home or away. Creating it sends nothing.</p>
      <Card>
        <ActionForm action={createHubEventAction} submitLabel="Create event" pendingLabel="Creating…">
          <EventFields venues={venues} teams={teams.filter((t) => t.active)} defaultDate={date} />
        </ActionForm>
      </Card>
    </section>
  );
}
