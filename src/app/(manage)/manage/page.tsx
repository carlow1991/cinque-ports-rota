import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, LinkButton } from "@/components/ui";
import { CoverBand } from "@/components/hub/cover-band";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadNames, placeName } from "@/lib/data/hub-events";
import { loadOpenRequests, loadOverview, loadVenueCovers, type EventCounts } from "@/lib/data/hub-involvement";
import { loadAttention } from "@/lib/data/hub-attention";
import { eventTimeLabel, groupByDayAndPlace } from "@/lib/domain/hub-calendar";
import { coversFor } from "@/lib/domain/venue-cover";
import { addDays, formatDateKey, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Manage" };

/** Organiser home (spec 01 §12): what needs attention, then the next 7 days by day and venue. */
export default function ManagePage() {
  return <Suspense fallback={<PageLoading />}><Overview /></Suspense>;
}

/** Status counts in words (never colour alone). Expected and Available are never called confirmed. */
function Counts({ c, help }: { c: EventCounts; help: boolean }) {
  const items: [number, string, "good" | "neutral" | "info" | "warn"][] = [
    [c.confirmed, "confirmed", "good"], [c.expected, "expected", "neutral"], [c.available, "available", "info"], [c.pending, "invited, awaiting reply", "warn"], [c.unanswered, "asked, not replied", "warn"],
  ];
  const shown = items.filter(([n]) => n > 0);
  if (shown.length === 0) return <span className="text-xs text-ink-muted">{help ? "No one yet" : "For information"}</span>;
  return <span className="flex flex-wrap gap-1">{shown.map(([n, t, tone]) => <Badge key={t} tone={tone}>{n} {t}</Badge>)}</span>;
}

async function Overview() {
  const me = await requireLevel(HUB_MANAGERS);
  const today = todayKey();
  const from = startOfLondonDay(today), to = startOfLondonDay(addDays(today, 7));
  const [ov, names, covers, open, attention] = await Promise.all([loadOverview(from, to), loadNames(), loadVenueCovers(from, to), loadOpenRequests(), loadAttention()]);
  const groups = groupByDayAndPlace(ov.events, (e) => placeName(e, names));
  const peopleOn = new Map(ov.days.map((d) => [d.day, d.people]));
  const attentionItems: { n: number; text: string; href: string }[] = [
    { n: open.invitations.length, text: "invitations awaiting an answer", href: "/manage/requests" },
    { n: open.unanswered.reduce((a, u) => a + u.unanswered, 0), text: "people asked who haven't replied", href: "/manage/requests" },
    { n: ov.needs_check.length, text: "availability replies to check (finish time not recorded)", href: "/manage/requests" },
    { n: attention.new_applications, text: "new volunteer applications", href: "/manage/applications" },
    { n: attention.roles_recruiting, text: "club roles looking for help", href: "/manage/club-roles" },
    { n: ov.drafts, text: "draft events not yet published", href: "/manage/events" },
  ].filter((x) => x.n > 0);

  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 id="h" className="text-2xl font-bold text-club">Overview</h1>
          <p className="text-sm text-ink-muted">{formatDateKey(today)} – {formatDateKey(addDays(today, 6))}</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href="/manage/events/new">+ Event</LinkButton>
          {me.level === "admin" ? <LinkButton href="/manage/people/new" variant="secondary">+ Person</LinkButton> : null}
        </div>
      </div>

      <Card title="Needs attention">
        {attentionItems.length === 0 ? <p className="text-sm">Nothing waiting.</p> : (
          <ul className="space-y-1">
            {attentionItems.map((a) => <li key={a.text}><Link className="font-semibold text-club-blue underline" href={a.href}>{a.n} {a.text}</Link></li>)}
          </ul>
        )}
      </Card>

      <h2 className="text-lg font-bold text-club">This week</h2>
      {groups.length === 0 ? <Card><p className="text-sm">No events in the next 7 days. <Link className="text-club-blue underline" href="/manage/events/new">Add one</Link></p></Card> : groups.map((g) => (
        <section key={g.day} aria-label={g.label} className="space-y-2 rounded-xl border border-line bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold text-club">{g.label}</h3>
            {peopleOn.get(g.day) ? <span className="text-sm">{peopleOn.get(g.day)} {peopleOn.get(g.day) === 1 ? "person" : "people"} confirmed to help (each counted once)</span> : null}
          </div>
          {g.places.map((p) => (
            <div key={p.place} className="space-y-1">
              <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{p.place}{p.events.length > 1 ? ` · ${p.events.length} overlapping events` : ""}</p>
              <CoverBand covers={coversFor(covers, g.day, p.events[0].venue_id)} />
              <ul className="divide-y divide-line">
                {p.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/calendar/${e.id}`} className="font-semibold text-club-blue underline">{e.title}</Link>
                      <p className="text-xs text-ink-muted">{eventTimeLabel(e)}{e.status === "cancelled" ? " · Cancelled" : ""}</p>
                    </div>
                    <Counts c={e.counts} help={e.volunteers_enabled} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <p className="flex flex-wrap gap-4 text-sm">
        <Link className="font-semibold text-club-blue underline" href="/manage/venue-cover">Assign venue cover</Link>
        <Link className="font-semibold text-club-blue underline" href="/manage/requests">Requests</Link>
      </p>
    </section>
  );
}
