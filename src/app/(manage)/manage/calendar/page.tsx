import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { EventCard } from "@/components/event-card";
import { EVENT_TYPE_LABEL, LinkButton } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadManagedVenueIds, loadOverview, loadVenues } from "@/lib/data/manage";
import { groupByDay } from "@/lib/domain/calendar";
import { addDays, formatDateKey, isDateKey, startOfLondonDay, startOfWeek, todayKey } from "@/lib/time/london";
import { EventsTabs, NewEventButton } from "@/components/manage-nav";

export const metadata: Metadata = { title: "Calendar" };

export default function CalendarPage({ searchParams }: PageProps<"/manage/calendar">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Calendar searchParams={searchParams} />
    </Suspense>
  );
}

async function Calendar({ searchParams }: { searchParams: PageProps<"/manage/calendar">["searchParams"] }) {
  const me = await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const week = startOfWeek(typeof sp.week === "string" && isDateKey(sp.week) ? sp.week : todayKey());
  const venueFilter = typeof sp.venue === "string" ? sp.venue : "";
  const typeFilter = typeof sp.type === "string" && sp.type in EVENT_TYPE_LABEL ? sp.type : "";
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const [allVenues, managed, all] = await Promise.all([
    loadVenues(),
    loadManagedVenueIds(me.role === "admin", me.id),
    loadOverview(startOfLondonDay(week), startOfLondonDay(addDays(week, 7)), venueFilter || null),
  ]);
  const venues = allVenues.filter((v) => managed === "all" || managed.includes(v.id));
  const events = typeFilter ? all.filter((e) => e.event_type === typeFilter) : all;
  const byDay = groupByDay(events, days);
  const href = (o: Record<string, string>) => {
    const p = new URLSearchParams({ week, ...(venueFilter ? { venue: venueFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}), ...o });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/manage/calendar?${p.toString()}`;
  };

  return (
    <section aria-labelledby="cal-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><EventsTabs current="calendar" /><NewEventButton /></div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="cal-heading" className="text-2xl font-bold text-club">Calendar</h1>
        <LinkButton href="/manage/events/new">New event</LinkButton>
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/manage/calendar">
        <input type="hidden" name="week" value={week} />
        <label className="text-sm">
          <span className="block font-semibold">Venue</span>
          <select name="venue" defaultValue={venueFilter} className="rounded-lg border border-line bg-white px-3 py-2">
            <option value="">{managed === "all" ? "Both venues" : "My venues"}</option>
            {venues.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block font-semibold">Type</span>
          <select name="type" defaultValue={typeFilter} className="rounded-lg border border-line bg-white px-3 py-2">
            <option value="">All types</option>
            {Object.entries(EVENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="min-h-11 rounded-lg border border-line bg-white px-4 font-semibold text-club">Show</button>
      </form>

      <nav aria-label="Weeks" className="flex items-center justify-between gap-2">
        <Link className="min-h-11 rounded-lg border border-line bg-white px-3 py-2 font-semibold text-club" href={href({ week: addDays(week, -7) })}>
          ← Previous
        </Link>
        <p className="text-center text-sm font-semibold">
          Week of {formatDateKey(week)}
          <span className="block text-xs font-normal text-ink-muted">All times UK (GMT/BST)</span>
        </p>
        <Link className="min-h-11 rounded-lg border border-line bg-white px-3 py-2 font-semibold text-club" href={href({ week: addDays(week, 7) })}>
          Next →
        </Link>
      </nav>

      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <section key={d} aria-labelledby={`day-${d}`} className="space-y-2">
            <h2 id={`day-${d}`} className={`text-base font-semibold ${d === todayKey() ? "text-club-blue" : ""}`}>
              {formatDateKey(d)}{d === todayKey() ? " (today)" : ""}
            </h2>
            {list.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing scheduled.</p>
            ) : (
              <div className="space-y-2">
                {list.map(({ event, overlapsWith }) => <EventCard key={`${d}-${event.event_id}`} e={event} overlapsWith={overlapsWith} />)}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
