import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card } from "@/components/ui";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadOpenRequests } from "@/lib/data/hub-involvement";
import { formatPhone } from "@/lib/domain/hub-tags";
import { formatDay, formatTime } from "@/lib/time/london";
import { recordAssignmentResponseAction } from "../events/involvement-actions";

export const metadata: Metadata = { title: "Requests" };

/** Volunteer requests still waiting: direct invitations without an answer, and unanswered availability. */
export default function RequestsPage() {
  return <Suspense fallback={<PageLoading />}><Requests /></Suspense>;
}

async function Requests() {
  await requireLevel(HUB_MANAGERS);
  const r = await loadOpenRequests();
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Requests</h1>
      <Card title={`Invitations awaiting an answer (${r.invitations.length})`}>
        {r.invitations.length === 0 ? <p className="text-sm text-ink-muted">None.</p> : (
          <ul className="space-y-2">
            {r.invitations.map((i) => (
              <li key={i.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{i.name}</span>
                  <Badge tone="warn">{i.state === "needs_reconfirmation" ? "Needs to reconfirm" : "Awaiting reply"}</Badge>
                  {i.invitation_source === "offline" ? <Badge>No Hub login — contact them</Badge> : null}
                </div>
                <p className="text-sm">{i.label ?? (i.scope === "venue" ? "Venue cover" : "General help")}{i.event_title ? <> — <Link className="text-club-blue underline" href={`/calendar/${i.event_id}`}>{i.event_title}</Link></> : null}</p>
                <p className="text-sm text-ink-muted">{formatDay(new Date(i.starts_at))} {formatTime(new Date(i.starts_at))}{i.phone ? ` · ${formatPhone(i.phone)}` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: yes" variant="secondary" className="">
                    <input type="hidden" name="assignment_id" value={i.id} /><input type="hidden" name="accept" value="yes" />
                  </ActionForm>
                  <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: no" variant="secondary" className="">
                    <input type="hidden" name="assignment_id" value={i.id} /><input type="hidden" name="accept" value="no" />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Availability not replied">
        {r.unanswered.length === 0 ? <p className="text-sm text-ink-muted">Everyone you asked has replied.</p> : (
          <ul className="divide-y divide-line">
            {r.unanswered.map((u) => (
              <li key={u.event_id} className="py-2">
                <Link href={`/calendar/${u.event_id}`} className="font-semibold text-club-blue underline">{u.title}</Link>
                <p className="text-sm text-ink-muted">{formatDay(new Date(u.starts_at))} · {u.unanswered} of {u.asked} asked haven&apos;t replied</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
