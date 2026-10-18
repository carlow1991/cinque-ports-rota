import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, DemoBadge, EVENT_TYPE_LABEL, Notice } from "@/components/ui";
import { requireVolunteer } from "@/lib/auth/dal";
import { loadMyDutiesNow, loadOpportunities, loadRota, loadVenueAndTeamOptions, type MyDuty, type Opportunity, type RotaEvent } from "@/lib/data/volunteer";
import { formatDuration, nextConfirmed } from "@/lib/domain/duty-time";
import { groupMyDuties } from "@/lib/domain/my-duties";
import { addDays, formatDateKey, formatDay, formatLongDay, formatRange, formatTime, londonParts, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Rota" };

export default function RotaPage({ searchParams }: PageProps<"/rota">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Rota searchParams={searchParams} />
    </Suspense>
  );
}

const WEEKS_STEP = 4;

async function Rota({ searchParams }: { searchParams: PageProps<"/rota">["searchParams"] }) {
  const me = await requireVolunteer();
  const sp = await searchParams;
  const venue = typeof sp.venue === "string" ? sp.venue : "";
  const type = typeof sp.type === "string" && sp.type in EVENT_TYPE_LABEL ? sp.type : "";
  const team = typeof sp.team === "string" ? sp.team : "";
  const onlyOpen = sp.open === "1";
  const weeks = Math.min(26, Math.max(WEEKS_STEP, Number(sp.weeks) || WEEKS_STEP));
  // The plain /rota address is the volunteer's home: their next duty and what they can take first.
  const landing = !venue && !type && !team && !onlyOpen && weeks === WEEKS_STEP;

  const today = todayKey();
  const [all, opts] = await Promise.all([
    loadRota(startOfLondonDay(today), startOfLondonDay(addDays(today, weeks * 7)), venue || null),
    loadVenueAndTeamOptions(),
  ]);
  const events = all.filter((e) => (!type || e.event_type === type) && (!team || e.team_id === team) && (!onlyOpen || e.eligible_open_slots > 0));

  const byDay = new Map<string, RotaEvent[]>();
  for (const e of events) {
    const d = londonParts(new Date(e.starts_at)).dateKey;
    byDay.set(d, [...(byDay.get(d) ?? []), e]);
  }

  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ venue, type, team, open: onlyOpen ? "1" : "", weeks: String(weeks), ...o });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "weeks" && v === String(WEEKS_STEP))) p.delete(k);
    const s = p.toString();
    return s ? `/rota?${s}` : "/rota";
  };

  return (
    <section aria-labelledby="rota-heading" className="space-y-4">
      <div>
        <h1 id="rota-heading" className="text-2xl font-bold text-club">Rota</h1>
        <p className="text-sm text-ink-muted">Hi {me.displayName.split(" ")[0]}. All times are UK time.</p>
      </div>

      {landing ? <Suspense fallback={<PageLoading label="Loading your duties…" />}><VolunteerHome /></Suspense> : null}

      <h2 id="all-events" className="pt-2 text-lg font-semibold text-club">All events</h2>

      <nav aria-label="Venue" className="flex flex-wrap gap-1 rounded-xl bg-white p-1 text-center text-sm">
        {[{ id: "", name: "All" }, ...opts.venues].map((v) => {
          const active = venue === v.id;
          return (
            <Link key={v.id || "all"} href={qs({ venue: v.id })} aria-current={active ? "page" : undefined}
              className={`flex min-h-11 flex-1 basis-24 items-center justify-center rounded-lg px-2 font-semibold ${active ? "bg-club text-white" : "text-club"}`}>
              {v.name}
            </Link>
          );
        })}
      </nav>

      <details className="rounded-xl border border-line bg-white p-3" open={Boolean(type || team || onlyOpen)}>
        <summary className="cursor-pointer text-sm font-semibold text-club">Filters{type || team || onlyOpen ? " (on)" : ""}</summary>
        <form action="/rota" className="mt-3 grid gap-3">
          {venue ? <input type="hidden" name="venue" value={venue} /> : null}
          <label className="text-sm">
            <span className="block font-semibold">Type</span>
            <select name="type" defaultValue={type} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2">
              <option value="">All types</option>
              {Object.entries(EVENT_TYPE_LABEL).filter(([k]) => k !== "venue_coverage").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="venue_coverage">Venue opening / closing</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="block font-semibold">Team</span>
            <select name="team" defaultValue={team} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2">
              <option value="">All teams</option>
              {opts.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" name="open" value="1" defaultChecked={onlyOpen} className="h-5 w-5" />
            Only show events with a place I can take
          </label>
          <div className="flex gap-2">
            <button className="min-h-11 flex-1 rounded-lg bg-club px-4 font-semibold text-white">Apply</button>
            <Link href={venue ? `/rota?venue=${venue}` : "/rota"} className="flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold text-club">Clear</Link>
          </div>
        </form>
      </details>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-white p-4 text-ink-muted">
          {all.length === 0 ? "Nothing on the rota yet for the coming weeks. Check back soon." : "No events match these filters."}
        </p>
      ) : (
        [...byDay.entries()].map(([day, list]) => (
          <section key={day} aria-labelledby={`d-${day}`} className="space-y-2">
            <h2 id={`d-${day}`} className="text-base font-semibold">{formatDateKey(day)}{day === today ? " (today)" : ""}</h2>
            {list.map((e) => <RotaCard key={e.event_id} e={e} />)}
          </section>
        ))
      )}

      {weeks < 26 ? (
        <Link href={qs({ weeks: String(weeks + WEEKS_STEP) })} className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-white font-semibold text-club">
          Show the next {WEEKS_STEP} weeks
        </Link>
      ) : null}
    </section>
  );
}

function RotaCard({ e }: { e: RotaEvent }) {
  return (
    <Link href={`/rota/${e.event_id}`} className="block rounded-xl border border-line bg-white p-3 hover:border-club">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm tabular-nums text-ink-muted">{formatRange(new Date(e.starts_at), new Date(e.ends_at))}</span>
        <DemoBadge show={e.is_demo} />
        {e.my_active_count > 0 ? <Badge tone="good">✓ You&apos;re on this</Badge> : null}
      </div>
      <p className="mt-1 font-semibold text-club">{e.title}</p>
      <p className="text-sm text-ink-muted">
        {e.venue_name} · {EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}{e.team_name ? ` · ${e.team_name}` : ""}
      </p>
      <p className="mt-1 text-sm">
        {e.eligible_open_slots > 0 ? (
          <strong className="text-club-blue">{e.eligible_open_slots} {e.eligible_open_slots === 1 ? "place" : "places"} you can take →</strong>
        ) : e.open_slots > 0 ? (
          <span className="text-ink-muted">{e.open_slots} open, but none you can take right now</span>
        ) : (
          <span className="text-ink-muted">All volunteer places filled</span>
        )}
      </p>
    </Link>
  );
}

/* ---------------- Volunteer home (brief §3) ---------------- */

async function VolunteerHome() {
  const today = todayKey();
  const [{ duties, now }, opps] = await Promise.all([
    loadMyDutiesNow(),
    loadOpportunities(startOfLondonDay(today), startOfLondonDay(addDays(today, 56)), 6),
  ]);
  const { groups, recentChanges } = groupMyDuties(duties, now);
  const next = nextConfirmed(duties, now);
  const invites = groups.invited.length;
  const pending = groups.pending.length;
  const nothingYet = !next && invites === 0 && pending === 0;

  return (
    <div className="space-y-4">
      {recentChanges.map((d) => (
        <Notice key={d.assignment_id} tone="warn" title={d.status === "cancelled" ? "Duty cancelled" : "You've been taken off a duty"}>
          {d.duty_name}, {d.event_title}, {formatDay(new Date(d.starts_at))}. {d.event_status_reason ?? d.removal_reason ?? ""}
        </Notice>
      ))}

      {next ? <NextDutyCard d={next} /> : null}

      {invites || pending ? (
        <section aria-labelledby="waiting-h" className="rounded-xl border border-line bg-white p-3">
          <h2 id="waiting-h" className="text-base font-semibold text-club">Waiting for you</h2>
          <ul className="mt-1 space-y-1 text-sm">
            {invites ? (
              <li><Link href="/my-duties?tab=invited" className="font-semibold text-club-blue underline">
                {invites} {invites === 1 ? "invitation" : "invitations"} to answer →</Link></li>
            ) : null}
            {pending ? (
              <li><Link href="/my-duties?tab=pending" className="text-club-blue underline">
                {pending} {pending === 1 ? "duty is" : "duties are"} waiting for an organiser to approve →</Link></li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {nothingYet ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-4">
          <p className="font-semibold">You&apos;re not down for any duties yet.</p>
          <p className="text-sm text-ink-muted">
            {opps.length ? "Here are some you can take. Even an hour makes a difference." : "Nothing is open for you right now. Have a look at all events below, or check back soon."}
          </p>
        </div>
      ) : null}

      {opps.length ? (
        <section aria-labelledby="opps-h" className="space-y-2">
          <h2 id="opps-h" className="text-lg font-semibold text-club">Duties you can take</h2>
          <ul className="space-y-2">{opps.map((o) => <OpportunityCard key={o.shift_id} o={o} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function NextDutyCard({ d }: { d: MyDuty }) {
  const st = new Date(d.starts_at), en = new Date(d.ends_at);
  return (
    <section aria-labelledby="next-h" className="rounded-xl border-2 border-club bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="next-h" className="text-base font-semibold text-club">Your next duty</h2>
        {d.cancellation_pending ? <Badge tone="warn">You&apos;ve asked to cancel</Badge> : <Badge tone="good">✓ Confirmed</Badge>}
      </div>
      <p className="mt-1 text-lg font-bold">{formatLongDay(st)}</p>
      <p className="text-base">
        <strong>Arrive {formatTime(st)}</strong> · Finish {formatTime(en)} <span className="text-ink-muted">({formatDuration(st, en)})</span>
      </p>
      <p className="mt-1 font-semibold">{d.duty_name}</p>
      {d.responsibilities.length ? <p className="text-sm text-ink-muted">Includes: {d.responsibilities.join(", ")}</p> : null}
      <p className="text-sm">
        <Link href={`/rota/${d.event_id}`} className="text-club-blue underline">{d.event_title}</Link> · {d.venue_name}
      </p>
      {d.venue_address ? <p className="text-sm text-ink-muted">{d.venue_address}</p> : null}
      {d.event_status === "postponed" ? <p className="mt-1 text-sm font-semibold text-amber-900">⚠ Event postponed: {d.event_status_reason}</p> : null}
      {d.shift_instructions ? <p className="mt-2 whitespace-pre-line text-sm">{d.shift_instructions}</p> : null}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <a href={`/my-duties/${d.assignment_id}/calendar`} className="font-semibold text-club-blue underline">Add to my calendar</a>
        <Link href="/my-duties" className="text-club-blue underline">All my duties</Link>
      </p>
    </section>
  );
}

function OpportunityCard({ o }: { o: Opportunity }) {
  const st = new Date(o.starts_at), en = new Date(o.ends_at);
  return (
    <li>
      <Link href={`/rota/${o.event_id}#shift-${o.shift_id}`} className="block rounded-xl border border-line bg-white p-3 hover:border-club"
        aria-label={`${o.duty_name}, ${formatDay(st)} ${formatTime(st)} to ${formatTime(en)}, ${o.event_title}, ${o.venue_name}. ${o.open_slots} ${o.open_slots === 1 ? "place" : "places"} left. See details`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-club">{o.duty_name}</span>
          <DemoBadge show={o.is_demo} />
          {o.approval_required ? <Badge tone="info">Needs approval</Badge> : null}
        </div>
        <p className="text-sm"><span className="font-semibold">{formatDay(st)}</span> · {formatRange(st, en)} · {formatDuration(st, en)}</p>
        <p className="text-sm text-ink-muted">{o.event_title} · {o.venue_name}{o.team_name ? ` · ${o.team_name}` : ""}</p>
        <p className="mt-1 text-sm font-semibold text-club-blue">
          {o.open_slots} {o.open_slots === 1 ? "place" : "places"} left · See details →
        </p>
      </Link>
    </li>
  );
}
