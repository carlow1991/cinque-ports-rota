import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { EventCard } from "@/components/event-card";
import { Card, LinkButton } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import Link from "next/link";
import { loadActionQueue, loadManagedVenueIds, loadNextEvent, loadOverview } from "@/lib/data/manage";
import { groupByDay } from "@/lib/domain/calendar";
import { addDays, formatDateKey, formatDay, startOfLondonDay, todayKey } from "@/lib/time/london";

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
  const [events, queue] = await Promise.all([loadOverview(startOfLondonDay(today), startOfLondonDay(addDays(today, 7))), loadActionQueue()]);
  const live = events.filter((e) => e.status !== "cancelled" && e.status !== "completed");
  const next = live.length === 0
    ? await loadNextEvent(startOfLondonDay(addDays(today, 7)), await loadManagedVenueIds(me.role === "admin", me.id))
    : null;
  const lateCancels = queue.filter((q) => q.kind === "cancellation").length;
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

      {lateCancels ? (
        <Link href="/manage/approvals" className="block rounded-xl border border-amber-600/40 bg-amber-50 p-3 font-semibold text-amber-900">
          ⚠ {lateCancels} late cancellation request{lateCancels === 1 ? "" : "s"} waiting →
        </Link>
      ) : null}
      <ul aria-label="Next 7 days at a glance" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {([
          ["Events", totals.events, "/manage/calendar"],
          ["Open places", totals.open, "/manage/coverage?span=week"],
          ["Awaiting approval", totals.pending, "/manage/approvals"],
          ["Unanswered invites", totals.invited, "/manage/approvals"],
          ["Site lead missing / at risk", totals.noLead, "/manage/coverage?span=week"],
          ["Unpublished drafts", totals.drafts, "/manage/calendar"],
        ] as const).map(([label, n, href]) => (
          <li key={label}>
            <Link href={href} className="block h-full rounded-xl border border-line bg-white p-3 hover:border-club">
              <span className="block text-xs text-ink-muted">{label}</span>
              <span className="block text-2xl font-bold tabular-nums text-club">{n}</span>
            </Link>
          </li>
        ))}
      </ul>

      {live.length === 0 ? (
        <Card>
          <p className="text-ink-muted">No events in the next 7 days.</p>
          {next ? (
            <p className="mt-1 text-sm">Next scheduled: <Link href={`/manage/events/${next.id}`} className="font-semibold text-club-blue underline">{next.title}</Link>, {formatDay(new Date(next.starts_at))}{next.status === "draft" ? " (draft, not yet published)" : ""}</p>
          ) : <p className="mt-1 text-sm text-ink-muted">Nothing is scheduled yet. Use <strong>New event</strong> to add one.</p>}
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
