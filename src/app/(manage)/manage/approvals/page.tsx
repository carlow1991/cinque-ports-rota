import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadActionQueue, type QueueRow } from "@/lib/data/manage";
import { formatDay, formatRange } from "@/lib/time/london";
import { approveAction, rejectAction, resolveCancellationAction } from "../events/actions";

export const metadata: Metadata = { title: "Needs action" };

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Approvals />
    </Suspense>
  );
}

async function Approvals() {
  await requireRole(MANAGER_ROLES);
  const queue = await loadActionQueue();
  const cancellations = queue.filter((q) => q.kind === "cancellation");
  const approvals = queue.filter((q) => q.kind === "approval");
  const invitations = queue.filter((q) => q.kind === "invitation");

  return (
    <section aria-labelledby="na-heading" className="space-y-4">
      <h1 id="na-heading" className="text-2xl font-bold text-club">Needs action</h1>
      {queue.length === 0 ? <Card><p className="text-ink-muted">Nothing waiting. 🎉</p></Card> : null}

      {cancellations.length ? (
        <Card title={`Late cancellation requests (${cancellations.length})`}>
          <p className="mb-2 text-sm text-ink-muted">These volunteers are still on their duty until you decide.</p>
          <ul className="space-y-3">{cancellations.map((q) => (
            <Item key={q.request_id} q={q}>
              <p className="text-sm font-semibold text-amber-900">Reason: {q.reason || "none given"}</p>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={resolveCancellationAction} submitLabel="Let them cancel" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="request_id" value={q.request_id!} /><input type="hidden" name="decision" value="approve" />
                </ActionForm>
                <ActionForm action={resolveCancellationAction} submitLabel="Keep them on" variant="secondary" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="request_id" value={q.request_id!} /><input type="hidden" name="decision" value="decline" />
                </ActionForm>
              </div>
            </Item>
          ))}</ul>
        </Card>
      ) : null}

      {approvals.length ? (
        <Card title={`Waiting for approval (${approvals.length})`}>
          <p className="mb-2 text-sm text-ink-muted">Each request holds a place until you approve or decline it.</p>
          <ul className="space-y-3">{approvals.map((q) => (
            <Item key={q.assignment_id} q={q}>
              <div className="flex flex-wrap gap-2">
                <ActionForm action={approveAction} submitLabel="Approve" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="assignment_id" value={q.assignment_id} />
                </ActionForm>
                <ActionForm action={rejectAction} submitLabel="Decline" variant="secondary" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="assignment_id" value={q.assignment_id} />
                </ActionForm>
              </div>
            </Item>
          ))}</ul>
        </Card>
      ) : null}

      {invitations.length ? (
        <Card title={`Invitations not yet answered (${invitations.length})`}>
          <p className="mb-2 text-sm text-ink-muted">Invitations do not count as cover. Chase them, or invite someone else.</p>
          <ul className="space-y-3">{invitations.map((q) => <Item key={q.assignment_id} q={q} />)}</ul>
        </Card>
      ) : null}
    </section>
  );
}

function Item({ q, children }: { q: QueueRow; children?: React.ReactNode }) {
  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <p><strong>{q.display_name}</strong> · {q.duty_name}</p>
      <p className="text-sm">
        <Link href={`/manage/events/${q.event_id}`} className="text-club-blue underline">{q.event_title}</Link> · {q.venue_name} ·{" "}
        {formatDay(new Date(q.shift_starts_at))} {formatRange(new Date(q.shift_starts_at), new Date(q.shift_ends_at))}
      </p>
      {children}
    </li>
  );
}
