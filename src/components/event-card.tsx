import Link from "next/link";
import { CoverBadge, DemoBadge, EVENT_TYPE_LABEL, StatusBadge } from "@/components/ui";
import { formatRange } from "@/lib/time/london";
import type { OverviewRow } from "@/lib/data/manage";

/** One event in organiser lists. Counts are headcount; composite duties count once. */
export function EventCard({ e, overlapsWith = [] }: { e: OverviewRow; overlapsWith?: string[] }) {
  const closed = e.status === "cancelled" || e.status === "completed";
  return (
    <article className={`rounded-xl border bg-white p-3 ${closed ? "border-dashed border-line opacity-80" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm tabular-nums text-ink-muted">{formatRange(new Date(e.starts_at), new Date(e.ends_at))}</span>
        <StatusBadge status={e.status} />
        <DemoBadge show={e.is_demo} />
        {!closed ? <CoverBadge state={e.cover_state} /> : null}
      </div>
      <h3 className="mt-1 text-base font-semibold">
        <Link href={`/manage/events/${e.event_id}`} className="text-club underline-offset-2 hover:underline">
          {e.title}
        </Link>
      </h3>
      <p className="text-sm text-ink-muted">
        {e.venue_name} · {EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}
        {e.team_name ? ` · ${e.team_name}` : ""}
        {e.coverage_event_id ? " · uses venue-wide cover" : ""}
      </p>
      {!closed ? (
        <p className="mt-1 text-sm">
          {e.shift_rows === 0 ? (
            <span className="text-ink-muted">No duties yet</span>
          ) : (
            <>
              <strong>{e.confirmed}</strong> of {e.required_slots} places confirmed
              {e.pending ? ` · ${e.pending} awaiting approval` : ""}
              {e.invited ? ` · ${e.invited} invited (not counted)` : ""}
              {e.open_slots ? <> · <strong className="text-danger">{e.open_slots} open</strong></> : " · fully staffed"}
            </>
          )}
        </p>
      ) : null}
      {overlapsWith.length ? <p className="mt-1 text-xs text-ink-muted">Overlaps with: {overlapsWith.join(", ")}</p> : null}
    </article>
  );
}
