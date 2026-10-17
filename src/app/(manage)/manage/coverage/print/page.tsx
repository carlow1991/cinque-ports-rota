import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { PrintButton } from "@/components/print-button";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadCoverageWindow, type OverviewRow, type RosterRow } from "@/lib/data/manage";
import { addDays, formatDateKey, formatRange, formatTime, isDateKey, startOfLondonDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Day rota" };

const COVER_TEXT: Record<string, string> = {
  covered_by_volunteer: "Site lead confirmed",
  covered_by_provider: "Site run by external provider (admin-verified)",
  not_required: "No site lead needed",
  at_risk: "⚠ SITE LEAD NOT CONFIRMED FOR WHOLE WINDOW",
  no_cover: "⚠ NO SITE LEAD",
};

export default function PrintPage({ searchParams }: PageProps<"/manage/coverage/print">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <PrintRota searchParams={searchParams} />
    </Suspense>
  );
}

async function PrintRota({ searchParams }: { searchParams: PageProps<"/manage/coverage/print">["searchParams"] }) {
  await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const day = typeof sp.day === "string" && isDateKey(sp.day) ? sp.day : todayKey();
  const venue = typeof sp.venue === "string" ? sp.venue : null;
  const { overview, roster, now } = await loadCoverageWindow(startOfLondonDay(day), startOfLondonDay(addDays(day, 1)), venue);
  const events = overview.filter((e) => e.status !== "cancelled");

  const byVenue = new Map<string, OverviewRow[]>();
  for (const e of events) byVenue.set(e.venue_name, [...(byVenue.get(e.venue_name) ?? []), e]);

  return (
    <article className="space-y-4 bg-white text-black print:space-y-3 print:text-[11pt]">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/manage/coverage?day=${day}${venue ? `&venue=${venue}` : ""}`} className="text-sm font-semibold text-club-blue underline">← Back to coverage</Link>
        <PrintButton />
      </div>
      <header>
        <h1 className="text-xl font-bold">Cinque Ports FC: volunteer rota for {formatDateKey(day)}</h1>
        <p className="text-xs">Printed {formatTime(new Date(now))} UK time. Confirmed volunteers only, plus people not yet confirmed in brackets. Contact numbers are for organisers only: please don&apos;t leave this sheet lying around.</p>
      </header>

      {events.length === 0 ? <p>No events on this day.</p> : null}
      {[...byVenue.entries()].map(([venueName, list]) => (
        <section key={venueName} className="break-inside-avoid-page space-y-3">
          <h2 className="border-b-2 border-black text-lg font-bold">{venueName}</h2>
          {list.map((e) => <EventBlock key={e.event_id} e={e} rows={roster.filter((r) => r.event_id === e.event_id)} />)}
        </section>
      ))}
    </article>
  );
}

function EventBlock({ e, rows }: { e: OverviewRow; rows: RosterRow[] }) {
  const shifts = [...new Map(rows.map((r) => [r.shift_id, r])).values()];
  return (
    <div className="break-inside-avoid">
      <h3 className="font-bold">
        {formatRange(new Date(e.starts_at), new Date(e.ends_at))} · {e.title}{e.is_demo ? " [DEMO]" : ""}{e.status !== "published" ? ` [${e.status.toUpperCase()}]` : ""}
      </h3>
      {e.cover_state ? <p className="text-sm font-semibold">{COVER_TEXT[e.cover_state] ?? e.cover_state}{e.coverage_event_id ? " (venue-wide cover)" : ""}</p> : null}
      <table className="mt-1 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-black text-left">
            <th scope="col" className="w-24 py-1">Time</th><th scope="col" className="py-1">Duty</th><th scope="col" className="py-1">Volunteer</th>
            <th scope="col" className="py-1">Phone</th><th scope="col" className="w-12 py-1 text-center">Here?</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => {
            const confirmed = rows.filter((r) => r.shift_id === s.shift_id && r.status === "confirmed");
            const others = rows.filter((r) => r.shift_id === s.shift_id && (r.status === "pending_approval" || r.status === "invited"));
            const blanks = Math.max(0, s.required_count - confirmed.length);
            const lines: (RosterRow | null)[] = [...confirmed, ...Array.from({ length: blanks }, () => null)];
            return lines.map((p, i) => (
              <tr key={`${s.shift_id}-${i}`} className="border-b border-gray-400 align-top">
                {i === 0 ? (
                  <>
                    <td rowSpan={lines.length} className="py-1 font-mono tabular-nums">{formatRange(new Date(s.shift_starts_at), new Date(s.shift_ends_at))}</td>
                    <td rowSpan={lines.length} className="py-1">
                      <strong>{s.duty_name}</strong>
                      {s.responsibilities.length ? <span className="block text-xs">Includes: {s.responsibilities.join(", ")}</span> : null}
                      {others.length ? <span className="block text-xs">(Not confirmed: {others.map((o) => `${o.display_name}${o.status === "invited" ? " – invited" : " – awaiting approval"}`).join("; ")})</span> : null}
                    </td>
                  </>
                ) : null}
                <td className="py-1">{p ? p.display_name : <span className="text-gray-500">________________ (open)</span>}</td>
                <td className="py-1 tabular-nums">{p?.phone ?? ""}</td>
                <td className="py-1 text-center">{p ? (p.attendance_status === "present" ? "✓" : "☐") : ""}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
