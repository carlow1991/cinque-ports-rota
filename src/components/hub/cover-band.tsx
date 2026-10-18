import { Badge } from "@/components/ui";
import { alsoSupports, coverLine, type CoverLike } from "@/lib/domain/venue-cover";

/** Shared venue cover for one venue and day, listed once (never copied onto each event). */
export function CoverBand({ covers }: { covers: CoverLike[] }) {
  if (covers.length === 0) return null;
  return (
    <div className="rounded-lg border border-ok/30 bg-green-50 p-2" aria-label="Shared venue cover">
      <p className="text-xs font-semibold uppercase tracking-wide text-ok">Shared venue cover</p>
      <ul className="mt-1 space-y-1 text-sm">
        {covers.map((c, i) => (
          <li key={i}>
            <span className="font-semibold">{coverLine(c)}</span>
            {c.state !== "confirmed" ? <> <Badge tone="warn">{c.state === "pending" ? "Awaiting reply" : c.state === "needs_reconfirmation" ? "Needs to reconfirm" : c.state}</Badge></> : null}
            <span className="block text-xs text-ink-muted">{alsoSupports(c.events)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
