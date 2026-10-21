import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { HubEventCard } from "@/components/hub/event-card";
import { CoverBand } from "@/components/hub/cover-band";
import { loadVenueCovers, type VenueCoverRow } from "@/lib/data/hub-involvement";
import { coversFor } from "@/lib/domain/venue-cover";
import { Card, Checkbox, Field, Select } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { setCalendarViewAction } from "./view-actions";
import {
  CATEGORIES, eventsByDay, groupByDayAndPlace, isMonthKey, monthGrid, monthLabel, monthOf, shiftMonth, weekDays, weekLabel, type HubEvent,
} from "@/lib/domain/hub-calendar";
import { loadEventsBetween, loadNames, placeName, type Names } from "@/lib/data/hub-events";
import { addDays, formatDateKey, formatTime, isDateKey, startOfLondonDay, startOfWeek, todayKey, type DateKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Calendar" };

type View = "list" | "week" | "month";
const VIEWS: { code: View; label: string }[] = [
  { code: "list", label: "List" },
  { code: "week", label: "Week" },
  { code: "month", label: "Month" },
];
const WEEKDAYS = [["Mon", "Monday"], ["Tue", "Tuesday"], ["Wed", "Wednesday"], ["Thu", "Thursday"], ["Fri", "Friday"], ["Sat", "Saturday"], ["Sun", "Sunday"]] as const;

/** Every club event: a list (agenda, grouped by day and place), a week, or a month grid. Filters apply to all three. */
export default function CalendarPage(props: PageProps<"/calendar">) {
  return <Suspense fallback={<PageLoading />}><Calendar {...props} /></Suspense>;
}

async function Calendar({ searchParams }: PageProps<"/calendar">) {
  const me = await requirePerson();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  // An explicit view in the address wins; otherwise the person's last choice (saved on their account).
  const asView = (v: unknown): View | null => (v === "list" || v === "week" || v === "month" ? v : null);
  const view: View = asView(str("view")) ?? (await savedView()) ?? "list";
  const today = todayKey();
  const isManager = me.level !== "member";
  const showInactive = isManager && str("inactive") === "1";

  // The date range each view needs.
  const from = isDateKey(str("from")) ? str("from") : today;
  const weeks = Math.min(12, Math.max(1, Number(str("weeks")) || 4));
  const monday = startOfWeek(isDateKey(str("week")) ? str("week") : today);
  const month = isMonthKey(str("month")) ? str("month") : monthOf(today);
  const grid = monthGrid(month);
  const [rangeStart, rangeEnd] =
    view === "month" ? [grid[0][0], addDays(grid.at(-1)![6], 1)]
    : view === "week" ? [monday, addDays(monday, 7)]
    : [from, addDays(from, weeks * 7)];

  const [events, names, covers] = await Promise.all([
    loadEventsBetween(startOfLondonDay(rangeStart), startOfLondonDay(rangeEnd)), loadNames(),
    loadVenueCovers(startOfLondonDay(rangeStart), startOfLondonDay(rangeEnd))]);
  const venueFilter = str("venue"), teamFilter = str("team"), catFilter = str("type"), helpOnly = str("help") === "1";
  const list = events.filter((e) =>
    (!venueFilter || (venueFilter === "away" ? !e.venue_id : e.venue_id === venueFilter)) &&
    (!teamFilter || e.team_id === teamFilter) && (!catFilter || e.category === catFilter) &&
    (!helpOnly || (e.volunteers_enabled && e.status !== "cancelled")));
  const venueOptions = [...names.venues.entries()].filter(([, v]) => v.active || showInactive);
  const filters = Object.fromEntries(["venue", "team", "type", "help", "inactive"].filter((k) => str(k)).map((k) => [k, str(k)]));
  const href = (over: Record<string, string>) => `/calendar?${new URLSearchParams({ ...filters, ...over }).toString()}`;
  const filtered = Object.keys(filters).length > 0;

  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">Calendar</h1>
        {isManager ? <Link href="/manage/events/new" className="inline-flex min-h-11 items-center rounded-lg bg-club px-4 font-semibold text-white">+ Event</Link> : null}
      </div>

      <form action={setCalendarViewAction} aria-label="Calendar view" className="inline-flex rounded-lg border border-line bg-white p-1">
        {Object.entries(filters).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {VIEWS.map((v) => (
          <button key={v.code} type="submit" name="view" value={v.code} aria-pressed={view === v.code}
            className={`inline-flex min-h-11 min-w-16 items-center justify-center rounded-md px-3 text-sm font-semibold ${view === v.code ? "bg-club text-white" : "text-club"}`}>
            {v.label}
          </button>
        ))}
      </form>

      <details className="rounded-xl border border-line bg-white p-3" open={filtered || undefined}>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">Filter{filtered ? " (on)" : ""}</summary>
        <form className="mt-2 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="view" value={view} />
          {view === "month" ? <input type="hidden" name="month" value={month} /> : null}
          {view === "week" ? <input type="hidden" name="week" value={monday} /> : null}
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
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Apply</button>
            {filtered ? <Link href={`/calendar?view=${view}`} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-club-blue underline">Clear filters</Link> : null}
          </div>
        </form>
      </details>

      {view === "month" ? (
        <MonthView month={month} grid={grid} today={today} selected={isDateKey(str("day")) ? str("day") : monthOf(today) === month ? today : null}
          byDay={eventsByDay(list)} names={names} covers={covers} href={href} />
      ) : view === "week" ? (
        <WeekView monday={monday} today={today} byDay={eventsByDay(list)} names={names} href={href} />
      ) : (
        <ListView list={list} names={names} covers={covers} weeks={weeks} next={href({ view: "list", from: addDays(from, weeks * 7) })} />
      )}
    </section>
  );
}

/** The view this person last chose (stored in their account's metadata; per person, any device). */
async function savedView(): Promise<View | null> {
  const sb = await createClient();
  const { data } = await sb.auth.getUser().catch(() => ({ data: { user: null } }));
  const v = data.user?.user_metadata?.calendar_view;
  return v === "list" || v === "week" || v === "month" ? v : null;
}

/** Agenda for one or more days: grouped by place, shared venue cover shown once per place. */
function DayAgenda({ events, names, covers, headingLevel = 2 }: { events: HubEvent[]; names: Names; covers: VenueCoverRow[]; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return groupByDayAndPlace(events, (e) => placeName(e, names)).map((g) => (
    <section key={g.day} aria-label={g.label} className="space-y-2">
      <H className="sticky top-16 z-[1] bg-surface-muted py-1 text-lg font-bold text-club">{g.label}</H>
      {g.places.map((p) => (
        <div key={p.place} className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{p.place}{p.events.length > 1 ? ` · ${p.events.length} events` : ""}</p>
          <CoverBand covers={coversFor(covers, g.day, p.events[0].venue_id)} />
          {p.events.map((e) => <HubEventCard key={e.id} e={e} href={`/calendar/${e.id}`} team={e.team_id ? names.teams.get(e.team_id) : undefined} />)}
        </div>
      ))}
    </section>
  ));
}

function ListView({ list, names, covers, weeks, next }: { list: HubEvent[]; names: Names; covers: VenueCoverRow[]; weeks: number; next: string }) {
  if (!list.length) {
    return (
      <Card><p>No events in these {weeks} weeks.</p>
        <p className="mt-2"><Link className="font-semibold text-club-blue underline" href={next}>Look further ahead</Link></p></Card>
    );
  }
  return (
    <>
      <DayAgenda events={list} names={names} covers={covers} />
      <p><Link className="font-semibold text-club-blue underline" href={next}>Next {weeks} weeks</Link></p>
    </>
  );
}

function PeriodNav({ label, unit, prev, next, current, currentLabel }: { label: string; unit: "month" | "week"; prev: string; next: string; current: string | null; currentLabel: string }) {
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-club";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={prev} className={btn} aria-label={`Previous ${unit}`}>‹</Link>
      <h2 className="min-w-0 flex-1 text-center text-lg font-bold text-club" aria-live="polite">{label}</h2>
      <Link href={next} className={btn} aria-label={`Next ${unit}`}>›</Link>
      {current ? <Link href={current} className={btn}>{currentLabel}</Link> : null}
    </div>
  );
}

/** One line per event in the grid/week: time, title; cancelled struck through; help wanted marked in words. */
function EventChip({ e }: { e: HubEvent }) {
  const cancelled = e.status === "cancelled";
  return (
    <Link href={`/calendar/${e.id}`}
      className={`block truncate rounded px-1 py-0.5 text-xs leading-tight ${e.volunteers_enabled && !cancelled ? "bg-club-blue/10 font-semibold text-club" : "bg-surface-muted text-ink"} ${cancelled ? "line-through opacity-70" : ""}`}
      title={`${formatTime(new Date(e.starts_at))} ${e.title}${cancelled ? " (cancelled)" : ""}`}>
      {formatTime(new Date(e.starts_at))} {e.title}
      {e.volunteers_enabled && !cancelled ? <span className="sr-only"> (help wanted)</span> : null}
      {cancelled ? <span className="sr-only"> (cancelled)</span> : null}
      {e.status === "draft" ? <span className="sr-only"> (draft)</span> : null}
    </Link>
  );
}

function MonthView({ month, grid, today, selected, byDay, names, covers, href }: {
  month: string; grid: DateKey[][]; today: DateKey; selected: DateKey | null; byDay: Map<DateKey, HubEvent[]>;
  names: Names; covers: VenueCoverRow[]; href: (o: Record<string, string>) => string;
}) {
  const MAX = 3;
  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];
  return (
    <div className="space-y-3">
      <PeriodNav label={monthLabel(month)} unit="month" prev={href({ view: "month", month: shiftMonth(month, -1) })} next={href({ view: "month", month: shiftMonth(month, 1) })}
        current={monthOf(today) === month ? null : href({ view: "month" })} currentLabel="This month" />
      <table className="w-full table-fixed border-collapse overflow-hidden rounded-xl border border-line bg-white text-sm">
        <caption className="sr-only">{monthLabel(month)}. Choose a day to see its events below.</caption>
        <thead>
          <tr>{WEEKDAYS.map(([s, l]) => <th key={s} scope="col" abbr={l} className="border-b border-line py-1 text-xs font-semibold text-ink-muted"><span className="sm:hidden" aria-hidden>{s.slice(0, 1)}</span><span className="hidden sm:inline" aria-hidden>{s}</span><span className="sr-only">{l}</span></th>)}</tr>
        </thead>
        <tbody>
          {grid.map((week) => (
            <tr key={week[0]}>
              {week.map((d) => {
                const evs = byDay.get(d) ?? [];
                const inMonth = monthOf(d) === month;
                const isToday = d === today, isSel = d === selected;
                const live = evs.filter((e) => e.status !== "cancelled");
                return (
                  <td key={d} className={`h-16 border border-line p-0.5 align-top sm:h-24 ${inMonth ? "" : "bg-surface-muted/60 text-ink-muted"} ${isSel ? "outline outline-2 -outline-offset-2 outline-club" : ""}`}>
                    <Link href={href({ view: "month", month, day: d })} aria-current={isToday ? "date" : undefined}
                      aria-label={`${formatDateKey(d)}${isToday ? " (today)" : ""}: ${evs.length ? `${evs.length} event${evs.length > 1 ? "s" : ""}` : "no events"}`}
                      className="flex min-h-11 flex-col items-start gap-0.5 rounded p-0.5 hover:bg-surface-muted">
                      <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${isToday ? "bg-club text-white" : ""}`}>{Number(d.slice(8))}</span>
                      {evs.length ? (
                        <span className="sm:hidden" aria-hidden>
                          <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${live.some((e) => e.volunteers_enabled) ? "bg-club-blue text-white" : "bg-surface-muted text-ink"}`}>{evs.length}</span>
                        </span>
                      ) : null}
                    </Link>
                    <div className="hidden space-y-0.5 sm:block">
                      {evs.slice(0, MAX).map((e) => <EventChip key={e.id} e={e} />)}
                      {evs.length > MAX ? <Link href={href({ view: "month", month, day: d })} className="block px-1 text-xs font-semibold text-club-blue underline">+{evs.length - MAX} more</Link> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted">
        <span className="mr-1 inline-block h-3 w-3 rounded-sm bg-club-blue align-middle" aria-hidden /> Help wanted
        <span className="ml-3 line-through">Struck through</span> = cancelled
      </p>
      <section aria-labelledby="day-h" className="space-y-2">
        <h2 id="day-h" className="sr-only">{selected ? `Events on ${formatDateKey(selected)}` : "Events"}</h2>
        {!selected ? <Card><p className="text-sm">Tap a day to see its events.</p></Card>
          : selectedEvents.length ? <DayAgenda events={selectedEvents} names={names} covers={covers} headingLevel={3} />
          : <Card><p className="text-sm">Nothing on {formatDateKey(selected)}.</p></Card>}
      </section>
    </div>
  );
}

function WeekView({ monday, today, byDay, names, href }: {
  monday: DateKey; today: DateKey; byDay: Map<DateKey, HubEvent[]>; names: Names; href: (o: Record<string, string>) => string;
}) {
  const days = weekDays(monday);
  const thisWeek = startOfWeek(today);
  return (
    <div className="space-y-3">
      <PeriodNav label={weekLabel(monday)} unit="week" prev={href({ view: "week", week: addDays(monday, -7) })} next={href({ view: "week", week: addDays(monday, 7) })}
        current={monday === thisWeek ? null : href({ view: "week" })} currentLabel="This week" />
      <ol className="grid gap-2 lg:grid-cols-7">
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const isToday = d === today;
          return (
            <li key={d} className={`rounded-xl border bg-white p-2 ${isToday ? "border-club" : "border-line"}`} aria-current={isToday ? "date" : undefined}>
              <h3 className="text-sm font-bold text-club">{formatDateKey(d)}{isToday ? <span className="ml-1 rounded-full bg-club px-2 text-xs text-white">Today</span> : null}</h3>
              {evs.length === 0 ? <p className="text-xs text-ink-muted">Nothing on</p> : (
                <ul className="mt-1 space-y-1">
                  {evs.map((e) => (
                    <li key={e.id}>
                      <EventChip e={e} />
                      <span className="block px-1 text-[11px] text-ink-muted">{placeName(e, names)}{e.team_id && names.teams.get(e.team_id) ? ` · ${names.teams.get(e.team_id)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
