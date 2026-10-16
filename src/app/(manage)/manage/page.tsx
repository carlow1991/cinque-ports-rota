import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { EventCard } from "@/components/event-card";
import { Card, LinkButton } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadOverview } from "@/lib/data/manage";
import { groupByDay } from "@/lib/domain/calendar";
import { addDays, formatDateKey, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Organiser dashboard" };

export default function ManagePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const me = await requireRole(MANAGER_ROLES);
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const events = await loadOverview(startOfLondonDay(today), startOfLondonDay(addDays(today, 7)));
  const live = events.filter((e) => e.status !== "cancelled" && e.status !== "completed");
  const totals = {
    events: live.length,
    open: live.reduce((n, e) => n + e.open_slots, 0),
    pending: live.reduce((n, e) => n + e.pending, 0),
    invited: live.reduce((n, e) => n + e.invited, 0),
    noLead: live.filter((e) => e.cover_state === "at_risk" || e.cover_state === "no_cover").length,
    drafts: live.filter((e) => e.status === "draft").length,
  };
  const byDay = groupByDay(events, days);

  return (
    <section aria-labelledby="manage-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 id="manage-heading" className="text-2xl font-bold text-club">Next 7 days</h1>
          <p className="text-sm text-ink-muted">Signed in as {me.displayName}. All times UK.</p>
        </div>
        <LinkButton href="/manage/events/new">New event</LinkButton>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Events", totals.events],
          ["Open places", totals.open],
          ["Awaiting approval", totals.pending],
          ["Unanswered invites", totals.invited],
          ["Site lead missing / at risk", totals.noLead],
          ["Unpublished drafts", totals.drafts],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl border border-line bg-white p-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="text-2xl font-bold tabular-nums text-club">{n}</dd>
          </div>
        ))}
      </dl>

      {live.length === 0 ? (
        <Card>
          <p className="text-ink-muted">No events in the next 7 days.</p>
        </Card>
      ) : (
        days.map((d) => {
          const list = byDay.get(d) ?? [];
          if (list.length === 0) return null;
          return (
            <section key={d} className="space-y-2">
              <h2 className="text-base font-semibold">{formatDateKey(d)}{d === today ? " (today)" : ""}</h2>
              {list.map(({ event, overlapsWith }) => <EventCard key={`${d}-${event.event_id}`} e={event} overlapsWith={overlapsWith} />)}
            </section>
          );
        })
      )}
    </section>
  );
}
