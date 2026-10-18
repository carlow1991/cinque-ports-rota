import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { HubEventCard } from "@/components/hub/event-card";
import { CoverBand } from "@/components/hub/cover-band";
import { loadVenueCovers } from "@/lib/data/hub-involvement";
import { coversFor } from "@/lib/domain/venue-cover";
import { Card, Checkbox, Field, Select } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { CATEGORIES, groupByDayAndPlace } from "@/lib/domain/hub-calendar";
import { loadEventsBetween, loadNames, placeName } from "@/lib/data/hub-events";
import { addDays, isDateKey, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Calendar" };

/** Every club event, grouped by day and place. Agenda first; filters are optional. */
export default function CalendarPage(props: PageProps<"/calendar">) {
  return <Suspense fallback={<PageLoading />}><Calendar {...props} /></Suspense>;
}

async function Calendar({ searchParams }: PageProps<"/calendar">) {
  const me = await requirePerson();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const from = isDateKey(str("from")) ? str("from") : todayKey();
  const weeks = Math.min(12, Math.max(1, Number(str("weeks")) || 4));
  const to = addDays(from, weeks * 7);
  const isManager = me.level !== "member";
  const showInactive = isManager && str("inactive") === "1";
  const [events, names, covers] = await Promise.all([
    loadEventsBetween(startOfLondonDay(from), startOfLondonDay(to)), loadNames(), loadVenueCovers(startOfLondonDay(from), startOfLondonDay(to))]);
  const venueFilter = str("venue"), teamFilter = str("team"), catFilter = str("type"), helpOnly = str("help") === "1";
  const list = events.filter((e) =>
    (!venueFilter || (venueFilter === "away" ? !e.venue_id : e.venue_id === venueFilter)) &&
    (!teamFilter || e.team_id === teamFilter) && (!catFilter || e.category === catFilter) &&
    (!helpOnly || (e.volunteers_enabled && e.status !== "cancelled")));
  const groups = groupByDayAndPlace(list, (e) => placeName(e, names));
  const venueOptions = [...names.venues.entries()].filter(([, v]) => v.active || showInactive);
  const qs = (over: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")) as Record<string, string>, ...over }).toString();

  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">Calendar</h1>
        {isManager ? <Link href="/manage/events/new" className="inline-flex min-h-11 items-center rounded-lg bg-club px-4 font-semibold text-white">+ Event</Link> : null}
      </div>
      <details className="rounded-xl border border-line bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">Filter</summary>
        <form className="mt-2 grid gap-3 sm:grid-cols-3">
          <Field label="Where">
            <Select name="venue" defaultValue={venueFilter}>
              <option value="">Everywhere</option>
              {venueOptions.map(([id, v]) => <option key={id} value={id}>{v.name}{v.active ? "" : " (inactive)"}</option>)}
              <option value="away">Away / other locations</option>
            </Select>
          </Field>
          <Field label="Team">
            <Select name="team" defaultValue={teamFilter}><option value="">All teams</option>{[...names.teams.entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          </Field>
          <Field label="Type">
            <Select name="type" defaultValue={catFilter}><option value="">All types</option>{CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</Select>
          </Field>
          <Checkbox name="help" value="1" label="Only events asking for help" defaultChecked={helpOnly} />
          {isManager ? <Checkbox name="inactive" value="1" label="Show inactive venues" defaultChecked={showInactive} /> : null}
          <div className="sm:col-span-3"><button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Apply</button></div>
        </form>
      </details>

      {groups.length === 0 ? (
        <Card><p>No upcoming events in these {weeks} weeks.</p>
          <p className="mt-2"><Link className="font-semibold text-club-blue underline" href={`/calendar?${qs({ from: to })}`}>Look further ahead</Link></p></Card>
      ) : groups.map((g) => (
        <section key={g.day} aria-label={g.label} className="space-y-2">
          <h2 className="sticky top-16 z-[1] bg-surface-muted py-1 text-lg font-bold text-club">{g.label}</h2>
          {g.places.map((p) => (
            <div key={p.place} className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{p.place}{p.events.length > 1 ? ` · ${p.events.length} events` : ""}</h3>
              <CoverBand covers={coversFor(covers, g.day, p.events[0].venue_id)} />
              {p.events.map((e) => (
                <HubEventCard key={e.id} e={e} href={`/calendar/${e.id}`} team={e.team_id ? names.teams.get(e.team_id) : undefined} />
              ))}
            </div>
          ))}
        </section>
      ))}
      {groups.length ? <p><Link className="font-semibold text-club-blue underline" href={`/calendar?${qs({ from: to })}`}>Next {weeks} weeks</Link></p> : null}
    </section>
  );
}
