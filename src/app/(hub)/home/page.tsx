import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { loadEventsBetween, loadNames, placeName } from "@/lib/data/hub-events";
import { loadMyHome, type MyInvitation } from "@/lib/data/hub-involvement";
import { eventTimeLabel } from "@/lib/domain/hub-calendar";
import { addDays, formatDay, formatTime, startOfLondonDay, todayKey } from "@/lib/time/london";
import { respondAssignmentAction } from "../calendar/actions";

export const metadata: Metadata = { title: "Home" };

/** Member Home (spec 01 §12): what needs a reply, what I've agreed to, what's on. No statistics. */
export default function HomePage() {
  return <Suspense fallback={<PageLoading />}><Home /></Suspense>;
}

function when(i: Pick<MyInvitation, "begins_at" | "ends_at" | "event_starts_at">) {
  const start = i.begins_at ?? i.event_starts_at;
  if (!start) return "";
  const s = new Date(start);
  return `${formatDay(s)} · ${formatTime(s)}${i.ends_at ? `–${formatTime(new Date(i.ends_at))}` : ""}`;
}

async function Home() {
  const me = await requirePerson();
  const today = todayKey();
  const [home, events, names] = await Promise.all([loadMyHome(), loadEventsBetween(startOfLondonDay(today), startOfLondonDay(addDays(today, 14))), loadNames()]);
  const upcoming = events.filter((e) => e.status !== "draft").slice(0, 6);
  const nothing = home.invitations.length === 0 && home.requests.length === 0;
  const where = (venueId: string | null, ext: string | null) => placeName({ venue_id: venueId, external_location_text: ext }, names);

  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Hello, {me.name.split(" ")[0]}</h1>

      {home.invitations.map((i) => (
        <Card key={i.id} title={i.state === "needs_reconfirmation" ? "Please reconfirm" : "You've been asked to help"}>
          <p className="font-semibold">{i.label ?? "General help"}{i.event_title ? ` — ${i.event_title}` : ""}</p>
          <p className="text-sm text-ink-muted">{when(i)} · {where(i.venue_id, i.external_location_text)}</p>
          {i.state === "needs_reconfirmation" ? <p className="mt-1"><Badge tone="warn">The date, time or place changed</Badge></p> : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <ActionForm action={respondAssignmentAction} submitLabel="Accept" className="" submitAriaLabel={`Accept ${i.label ?? "help"}${i.event_title ? ` at ${i.event_title}` : ""}`}>
              <input type="hidden" name="assignment_id" value={i.id} /><input type="hidden" name="accept" value="yes" />
            </ActionForm>
            <ActionForm action={respondAssignmentAction} submitLabel="Decline" variant="secondary" className="" submitAriaLabel={`Decline ${i.label ?? "help"}${i.event_title ? ` at ${i.event_title}` : ""}`}>
              <input type="hidden" name="assignment_id" value={i.id} /><input type="hidden" name="accept" value="no" />
            </ActionForm>
            {i.event_id ? <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-club-blue underline" href={`/calendar/${i.event_id}`}>Details</Link> : null}
          </div>
        </Card>
      ))}

      {home.requests.length ? (
        <Card title="Can you help?">
          <ul className="space-y-2">
            {home.requests.map((r) => (
              <li key={r.event_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                <div>
                  <p className="font-semibold">{r.title}</p>
                  <p className="text-sm text-ink-muted">{formatDay(new Date(r.starts_at))} · {eventTimeLabel(r)} · {where(r.venue_id, r.external_location_text)}</p>
                </div>
                <Link href={`/calendar/${r.event_id}`} className="inline-flex min-h-11 items-center rounded-lg bg-club px-4 text-sm font-semibold text-white">Reply</Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {nothing ? <Card title="Nothing needs a reply"><p className="text-sm">When an organiser asks if you can help, it will appear here.</p></Card> : null}

      <Card title="You're helping">
        {home.commitments.length === 0 ? <p className="text-sm text-ink-muted">Nothing booked.</p> : (
          <ul className="space-y-2">
            {home.commitments.map((c) => (
              <li key={c.id} className="rounded-lg border border-line p-3">
                <p className="font-semibold">{c.label ?? "General help"}{c.event_title ? ` — ${c.event_title}` : ""}</p>
                <p className="text-sm text-ink-muted">{when(c)} · {where(c.venue_id, c.external_location_text)}</p>
                {c.event_id ? <Link className="text-sm font-semibold text-club-blue underline" href={`/calendar/${c.event_id}`}>Details</Link> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Coming up at the club">
        {upcoming.length === 0 ? <p className="text-sm text-ink-muted">No events in the next two weeks.</p> : (
          <ul className="divide-y divide-line">
            {upcoming.map((e) => (
              <li key={e.id} className="py-2">
                <Link href={`/calendar/${e.id}`} className="font-semibold text-club-blue underline">{e.title}</Link>
                <p className="text-sm text-ink-muted">{formatDay(new Date(e.starts_at))} · {eventTimeLabel(e)} · {placeName(e, names)}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2"><Link className="text-sm font-semibold text-club-blue underline" href="/calendar">Full calendar</Link></p>
      </Card>
      <p className="text-sm"><Link className="font-semibold text-club-blue underline" href="/opportunities">Club roles looking for help</Link></p>
    </section>
  );
}
