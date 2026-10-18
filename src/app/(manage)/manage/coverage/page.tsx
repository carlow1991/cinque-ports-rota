import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, CoverBadge, DemoBadge, LinkButton } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadCoverGaps, loadCoverageWindow, loadDutyTypes, loadManagedVenueIds, loadNextEvent, loadTeams, loadVenues } from "@/lib/data/manage";
import { parseRanges } from "@/lib/domain/coverage";
import { expectedOnSite, staffingByShift } from "@/lib/domain/staffing";
import { addDays, formatDateKey, formatDay, formatRange, formatTime, isDateKey, londonParts, startOfLondonDay, todayKey } from "@/lib/time/london";
import { EventsTabs, NewEventButton } from "@/components/manage-nav";

export const metadata: Metadata = { title: "Coverage" };

export default function CoveragePage({ searchParams }: PageProps<"/manage/coverage">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Coverage searchParams={searchParams} />
    </Suspense>
  );
}

async function Coverage({ searchParams }: { searchParams: PageProps<"/manage/coverage">["searchParams"] }) {
  const me = await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const day = typeof sp.day === "string" && isDateKey(sp.day) ? sp.day : todayKey();
  const span = sp.span === "week" ? 7 : 1;
  const venueParam = typeof sp.venue === "string" ? sp.venue : "";
  const team = typeof sp.team === "string" ? sp.team : "";
  const duty = typeof sp.duty === "string" ? sp.duty : "";
  const onlyGaps = sp.all !== "1";

  const from = startOfLondonDay(day);
  const to = startOfLondonDay(addDays(day, span));
  const [allVenues, managed, teams, duties] = await Promise.all([loadVenues(), loadManagedVenueIds(me.role === "admin", me.id), loadTeams(), loadDutyTypes()]);
  const venues = allVenues.filter((v) => v.active && (managed === "all" || managed.includes(v.id)));
  const { overview, roster } = await loadCoverageWindow(from, to, venueParam || null);

  const live = overview.filter((e) => e.status !== "cancelled" && e.status !== "completed");
  const atRisk = live.filter((e) => e.cover_state === "at_risk" || e.cover_state === "no_cover");
  const provider = live.filter((e) => e.cover_state === "covered_by_provider");
  const leadCovered = live.filter((e) => e.cover_state === "covered_by_volunteer");
  const [gapsByEvent, next] = await Promise.all([
    loadCoverGaps(atRisk.map((e) => e.event_id)),
    live.length === 0 ? loadNextEvent(to, venueParam ? [venueParam] : managed) : Promise.resolve(null),
  ]);

  const teamName = teams.find((t) => t.id === team)?.name;
  const allStaffing = staffingByShift(roster);
  const matching = allStaffing.filter((s) => (!teamName || s.team_name === teamName) && (!duty || s.duty_code === duty));
  const staffing = matching.filter((s) => !onlyGaps || s.open > 0 || s.pending > 0 || s.invited > 0 || s.at_risk > 0);
  const filtered = Boolean(teamName || duty);
  // Each empty state says which of these is true, rather than implying "all filled".
  const dutiesEmpty =
    allStaffing.length === 0 ? (live.length === 0 ? "No events in this period." : "No duties have been added to the events in this period.")
    : matching.length === 0 ? "No duties match these filters."
    : `No open places${filtered ? " for these filters" : ""}: all ${matching.length} ${matching.length === 1 ? "duty is" : "duties are"} fully confirmed.`;
  const leadEmpty =
    live.length === 0 ? "No events in this period."
    : leadCovered.length === 0 ? "None of the events in this period need a volunteer site lead."
    : `${leadCovered.length === 1 ? "The 1 event" : `All ${leadCovered.length} events`} needing a volunteer site lead ${leadCovered.length === 1 ? "has" : "have"} one confirmed for the whole time.`;

  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ day, span: span === 7 ? "week" : "", venue: venueParam, team, duty, all: onlyGaps ? "" : "1", ...o });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/manage/coverage?${p.toString()}`;
  };

  return (
    <section aria-labelledby="cov-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><EventsTabs current="coverage" /><NewEventButton /></div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="cov-heading" className="text-2xl font-bold text-club">Coverage</h1>
        <LinkButton variant="secondary" href={`/manage/coverage/print?day=${day}${venueParam ? `&venue=${venueParam}` : ""}`}>Print day rota</LinkButton>
      </div>

      <form action="/manage/coverage" className="grid grid-cols-2 gap-2 sm:grid-cols-6 sm:items-end">
        <label className="text-sm"><span className="block font-semibold">Date</span>
          <input type="date" name="day" defaultValue={day} className="w-full rounded-lg border border-line bg-white px-2 py-2" /></label>
        <label className="text-sm"><span className="block font-semibold">Show</span>
          <select name="span" defaultValue={span === 7 ? "week" : ""} className="w-full rounded-lg border border-line bg-white px-2 py-2">
            <option value="">That day</option><option value="week">7 days from it</option></select></label>
        <label className="text-sm"><span className="block font-semibold">Venue</span>
          <select name="venue" defaultValue={venueParam} className="w-full rounded-lg border border-line bg-white px-2 py-2">
            <option value="">{managed === "all" ? "Both venues" : "My venues"}</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="text-sm"><span className="block font-semibold">Team</span>
          <select name="team" defaultValue={team} className="w-full rounded-lg border border-line bg-white px-2 py-2">
            <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="text-sm"><span className="block font-semibold">Duty</span>
          <select name="duty" defaultValue={duty} className="w-full rounded-lg border border-line bg-white px-2 py-2">
            <option value="">All duties</option>{duties.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm sm:pb-2">
          <input type="checkbox" name="all" value="1" defaultChecked={!onlyGaps} className="h-5 w-5" /> Include fully staffed</label>
        <button className="col-span-2 min-h-11 rounded-lg bg-club px-4 font-semibold text-white sm:col-span-6 sm:w-40">Show</button>
      </form>

      <nav aria-label="Days" className="flex items-center justify-between">
        <Link href={qs({ day: addDays(day, -span) })} className="min-h-11 rounded-lg border border-line bg-white px-3 py-2 font-semibold text-club">← Earlier</Link>
        <p className="text-center text-sm font-semibold">{span === 1 ? formatDateKey(day) : `${formatDateKey(day)} + 6 days`}<span className="block text-xs font-normal text-ink-muted">UK time</span></p>
        <Link href={qs({ day: addDays(day, span) })} className="min-h-11 rounded-lg border border-line bg-white px-3 py-2 font-semibold text-club">Later →</Link>
      </nav>

      <Card title={`Site lead missing or at risk (${atRisk.length})`}>
        {live.length === 0 ? (
          <div className="text-sm text-ink-muted">
            <p>{leadEmpty}</p>
            {next ? <p className="mt-1">Next scheduled: <Link href={`/manage/events/${next.id}`} className="font-semibold text-club-blue underline">{next.title}</Link>, {formatDay(new Date(next.starts_at))}{next.status === "draft" ? " (draft)" : ""} · <Link href={qs({ day: londonParts(new Date(next.starts_at)).dateKey })} className="text-club-blue underline">show that day</Link></p>
              : <p className="mt-1">Nothing else is scheduled after this period.</p>}
          </div>
        ) : atRisk.length === 0 ? <p className="text-sm text-ink-muted">{leadEmpty}</p> : (
          <ul className="space-y-2">
            {atRisk.map((e) => {
              const gaps = parseRanges(gapsByEvent.get(e.event_id)?.gaps);
              return (
                <li key={e.event_id} className="rounded-lg border border-amber-600/40 bg-amber-50 p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><CoverBadge state={e.cover_state} /><DemoBadge show={e.is_demo} /></div>
                  <Link href={`/manage/events/${e.event_id}`} className="font-semibold text-club-blue underline">{e.title}</Link> · {e.venue_name} · {formatDay(new Date(e.starts_at))}
                  {gaps.map((g) => <p key={g.start.toISOString()}>No confirmed site lead · {formatRange(g.start, g.end)}</p>)}
                  {e.coverage_event_id ? <p className="text-ink-muted">Uses venue-wide cover. Fix it on the cover event.</p> : null}
                </li>
              );
            })}
          </ul>
        )}
        {provider.length ? (
          <p className="mt-2 text-sm"><Badge tone="info">Provider cover</Badge> {provider.map((e) => e.title).join(", ")}: run by an external provider (admin-verified, no volunteer named).</p>
        ) : null}
      </Card>

      <Card title={onlyGaps ? `Duties needing people (${staffing.length})` : `All duties (${staffing.length})`}>
        {staffing.length === 0 ? <p className="text-sm text-ink-muted">{dutiesEmpty}</p> : (
          <ul className="divide-y divide-line">
            {staffing.map((s) => (
              <li key={s.shift_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p><strong>{s.duty_name}</strong> · {formatDay(new Date(s.starts_at))} {formatRange(new Date(s.starts_at), new Date(s.ends_at))}</p>
                  <p className="text-ink-muted"><Link href={`/manage/events/${s.event_id}#shift-${s.shift_id}`} className="text-club-blue underline">{s.event_title}</Link> · {s.venue_name}{s.team_name ? ` · ${s.team_name}` : ""}</p>
                  <p>
                    {s.confirmed}/{s.required} confirmed
                    {s.pending ? ` · ${s.pending} awaiting approval` : ""}
                    {s.invited ? ` · ${s.invited} invited (not counted)` : ""}
                    {s.at_risk ? <> · <strong className="text-amber-800">{s.at_risk} asked to cancel</strong></> : ""}
                    {s.open ? <> · <strong className="text-danger">{s.open} open</strong></> : " · full"}
                  </p>
                </div>
                {s.open ? <LinkButton href={`/manage/shifts/${s.shift_id}/assign`} variant="secondary">Find someone</LinkButton> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {span === 1 ? venues.filter((v) => !venueParam || v.id === venueParam).map((v) => {
        const slots = expectedOnSite(roster, v.id, from, to, 30);
        const max = Math.max(1, ...slots.map((s) => s.expected));
        return (
          <Card key={v.id} title={`Expected on site: ${v.name}`}>
            <p className="mb-2 text-xs text-ink-muted">Confirmed volunteers whose duty covers each half hour, each person counted once. This is who is <em>expected</em>, not proof they are there.</p>
            {slots.length === 0 ? <p className="text-sm text-ink-muted">Nobody confirmed at this venue on this day.</p> : (
              <table className="w-full text-sm">
                <caption className="sr-only">Expected volunteers on site by half hour at {v.name}</caption>
                <thead><tr className="text-left text-xs text-ink-muted"><th scope="col" className="w-16">From</th><th scope="col">People expected</th></tr></thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.start.toISOString()}>
                      <th scope="row" className="py-0.5 pr-2 text-left font-mono font-normal tabular-nums">{formatTime(s.start)}</th>
                      <td className="py-0.5">
                        <div className="flex items-center gap-2">
                          <span aria-hidden="true" className="h-4 rounded-sm bg-club" style={{ width: `${(s.expected / max) * 70}%`, minWidth: s.expected ? 6 : 0 }} />
                          <span className="tabular-nums">{s.expected}</span>
                          <span className="hidden truncate text-xs text-ink-muted sm:inline">{s.names.join(", ")}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      }) : null}
    </section>
  );
}
