import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { EventCard } from "@/components/event-card";
import { NewEventButton } from "@/components/manage-nav";
import { Badge, Card, CoverBadge, LinkButton } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadActionQueue, loadCoverGaps, loadCoverageWindow, loadManagedVenueIds, loadNextEvent } from "@/lib/data/manage";
import { RANGE_DAYS, RANGE_LABEL, TIER_LABEL, buildAttention, parseRange, type AttentionItem, type RangePreset } from "@/lib/domain/attention";
import { groupByDay } from "@/lib/domain/calendar";
import { parseRanges } from "@/lib/domain/coverage";
import { staffingByShift } from "@/lib/domain/staffing";
import { addDays, formatDateKey, formatDay, formatRange, londonParts, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Overview" };

export default function ManagePage({ searchParams }: PageProps<"/manage">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

const TIER_TONE = { urgent: "bad", site_lead: "warn", open: "warn", reconfirm: "info", approval: "info", invitation: "neutral", draft: "neutral" } as const;

async function Overview({ searchParams }: { searchParams: PageProps<"/manage">["searchParams"] }) {
  const me = await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const today = todayKey();
  const nDays = RANGE_DAYS[range];
  const days = Array.from({ length: nDays }, (_, i) => addDays(today, i));
  const from = startOfLondonDay(today);
  const to = startOfLondonDay(addDays(today, nDays));

  const [{ overview, roster, now }, queue] = await Promise.all([loadCoverageWindow(from, to, null), loadActionQueue()]);
  const live = overview.filter((e) => e.status !== "cancelled" && e.status !== "completed");
  // Exact gaps only for events flagged by the database as missing or at risk (usually none or a few).
  const flagged = live.filter((e) => e.status !== "draft" && (e.cover_state === "at_risk" || e.cover_state === "no_cover"));
  const gapRows = await loadCoverGaps(flagged.map((e) => e.event_id));
  const gaps = new Map([...gapRows].map(([id, c]) => [id, parseRanges(c.gaps)]));
  const staffing = staffingByShift(roster);
  const { items, laterRequests } = buildAttention({ events: overview, shifts: staffing, queue, gaps, from, to, now: new Date(now), formatRange });

  let next: { id: string; title: string; starts_at: string; status: string; risk: string | null } | null = null;
  if (live.length === 0) {
    const n = await loadNextEvent(to, await loadManagedVenueIds(me.role === "admin", me.id));
    if (n) next = { ...n, risk: (await loadCoverGaps([n.id])).get(n.id)?.state ?? null };
  }

  const totals = {
    open: live.reduce((s, e) => s + e.open_slots, 0),
    pending: live.reduce((s, e) => s + e.pending, 0),
    invited: live.reduce((s, e) => s + e.invited, 0),
  };
  const byDay = groupByDay(overview, days);
  const lastDay = days[days.length - 1];

  return (
    <section aria-labelledby="ov-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 id="ov-heading" className="text-2xl font-bold text-club">Overview</h1>
          <p className="text-sm text-ink-muted">Signed in as {me.displayName}. All times UK.</p>
        </div>
        <NewEventButton />
      </div>

      <RangePresets current={range} />
      <p className="text-sm font-semibold">
        {nDays === 1 ? formatDateKey(today) : `${formatDateKey(today)} to ${formatDateKey(lastDay)}`}
      </p>

      <Card title={`Needs attention (${items.length})`}>
        {items.length ? (
          <>
            <ol className="divide-y divide-line">
              {items.slice(0, FIRST).map((it) => <AttentionRow key={it.key} it={it} />)}
            </ol>
            {items.length > FIRST ? (
              <details className="group mt-1 border-t border-line">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-club-blue underline">
                  Show {items.length - FIRST} more
                </summary>
                <ol start={FIRST + 1} className="divide-y divide-line">
                  {items.slice(FIRST).map((it) => <AttentionRow key={it.key} it={it} />)}
                </ol>
              </details>
            ) : null}
          </>
        ) : live.length === 0 ? (
          <div className="text-sm">
            <p className="text-ink-muted">No events in this range, so nothing to check here.</p>
            {next ? (
              <p className="mt-1">
                Next scheduled: <Link href={`/manage/events/${next.id}`} className="font-semibold text-club-blue underline">{next.title}</Link>,{" "}
                {formatDay(new Date(next.starts_at))}{next.status === "draft" ? " (draft, not yet published)" : ""}{" "}
                {next.risk ? <CoverBadge state={next.risk} /> : null}
              </p>
            ) : <p className="mt-1 text-ink-muted">Nothing else is scheduled yet. Use <strong>New event</strong> to add one.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            Nothing needs action for the {plural(live.length, "event")} in this range: every duty is fully confirmed, every event that needs a site
            lead has one for the whole time, and there are no requests waiting.
          </p>
        )}
        {laterRequests ? (
          <p className="mt-2 text-sm">
            {plural(laterRequests, "more request")} {laterRequests === 1 ? "is" : "are"} for duties after this range.{" "}
            <Link href="/manage/approvals" className="text-club-blue underline">See all requests</Link>
          </p>
        ) : null}
      </Card>

      {live.length ? (
        <p className="text-sm text-ink-muted">
          In this range: {plural(live.length, "event")} · {plural(totals.open, "open place")} · {totals.pending} awaiting approval ·{" "}
          {totals.invited} invited (not counted as cover)
        </p>
      ) : null}

      {live.length ? (
        <section aria-labelledby="ov-events" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="ov-events" className="text-lg font-semibold text-club">Events in this range</h2>
            <Link href="/manage/calendar" className="text-sm text-club-blue underline">Calendar view</Link>
          </div>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            if (list.length === 0) return null;
            return (
              <section key={d} className="space-y-2">
                <h3 className="text-base font-semibold">{formatDateKey(d)}{d === today ? " (today)" : ""}</h3>
                {list.map(({ event, overlapsWith }) => <EventCard key={`${d}-${event.event_id}`} e={event} overlapsWith={overlapsWith} />)}
              </section>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

/** Rows shown before "Show N more"; the most urgent are always first. */
const FIRST = 8;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function RangePresets({ current }: { current: RangePreset }) {
  return (
    <nav aria-label="Date range" className="flex flex-wrap gap-2">
      {(["today", "7", "28"] as const).map((r) => (
        <Link key={r} href={r === "28" ? "/manage" : `/manage?range=${r}`} aria-current={r === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-semibold ${
            r === current ? "border-club bg-club text-white" : "border-line bg-white text-club hover:border-club"}`}>
          {RANGE_LABEL[r]}
        </Link>
      ))}
    </nav>
  );
}

function AttentionRow({ it }: { it: AttentionItem }) {
  const start = new Date(it.startsAt), end = new Date(it.endsAt);
  const day = londonParts(start).dateKey;
  return (
    <li className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={TIER_TONE[it.tier]}>{TIER_LABEL[it.tier]}</Badge>
          <span className="font-semibold">{formatDay(start)}</span>
          <span className="font-mono tabular-nums">{formatRange(start, end)}</span>
        </p>
        <p>
          <Link href={`/manage/events/${it.eventId}`} className="font-semibold text-club-blue underline">{it.eventTitle}</Link>
          {" · "}{it.venue}{it.duty ? ` · ${it.duty}` : ""}
        </p>
        <p>{it.reason}.</p>
      </div>
      <LinkButton href={it.action.href} variant={it.tier === "urgent" ? "primary" : "secondary"} className="self-start"
        aria-label={`${it.action.label}: ${it.duty ?? it.eventTitle}, ${formatDateKey(day)}`}>
        {it.action.label}
      </LinkButton>
    </li>
  );
}
