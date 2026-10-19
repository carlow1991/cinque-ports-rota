import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { categoryLabel, eventTimeLabel, type HubEvent } from "@/lib/domain/hub-calendar";

/** One event, one card: overlapping events are never merged. Status always in words, not colour alone. */
export function HubEventCard({ e, href, team, place, children }: { e: HubEvent; href: string; team?: string; place?: string; children?: ReactNode }) {
  const cancelled = e.status === "cancelled";
  return (
    <article className={`rounded-xl border bg-white p-3 ${cancelled ? "border-line opacity-80" : e.volunteers_enabled ? "border-club-blue/40" : "border-line"}`}>
      <p className="text-sm font-semibold text-ink-muted">{eventTimeLabel(e)}</p>
      <h3 className="text-base font-semibold">
        <Link href={href} className={`text-club-blue underline ${cancelled ? "line-through" : ""}`}>{e.title}</Link>
      </h3>
      <p className="text-sm text-ink-muted">{[categoryLabel(e.category), team, place].filter(Boolean).join(" · ")}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {e.status === "draft" ? <Badge>Draft — not visible to members</Badge> : null}
        {cancelled ? <Badge tone="bad">Cancelled</Badge> : null}
        {e.status === "postponed" ? <Badge tone="warn">Postponed</Badge> : null}
        {e.is_demo ? <Badge tone="demo">DEMO</Badge> : null}
        {e.volunteers_enabled && !cancelled ? <Badge tone="info">Help wanted</Badge> : <span className="text-xs text-ink-muted">For information</span>}
      </div>
      {children}
    </article>
  );
}
