import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { DemoBadge, Notice } from "@/components/ui";
import { requireVolunteer } from "@/lib/auth/dal";
import { loadMyDutiesNow, type MyDuty } from "@/lib/data/volunteer";
import { groupMyDuties, MY_DUTY_TABS, pickTab } from "@/lib/domain/my-duties";
import { formatDay, formatRange, formatTime } from "@/lib/time/london";
import { acceptAction, declineAction, requestCancellationAction, withdrawAction } from "../actions";

export const metadata: Metadata = { title: "My Duties" };

const TABS = MY_DUTY_TABS;

export default function MyDutiesPage({ searchParams }: PageProps<"/my-duties">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MyDuties searchParams={searchParams} />
    </Suspense>
  );
}

async function MyDuties({ searchParams }: { searchParams: PageProps<"/my-duties">["searchParams"] }) {
  await requireVolunteer();
  const sp = await searchParams;
  const { duties, now } = await loadMyDutiesNow();
  const { groups, recentChanges } = groupMyDuties(duties, now);
  const tab = pickTab(sp.tab, groups);
  const list = groups[tab];

  return (
    <section aria-labelledby="duties-heading" className="space-y-4">
      <h1 id="duties-heading" className="text-2xl font-bold text-club">My Duties</h1>

      {recentChanges.map((d) => (
        <Notice key={d.assignment_id} tone="warn" title={d.status === "cancelled" ? "Duty cancelled" : "You've been taken off a duty"}>
          {d.duty_name}, {d.event_title}, {formatDay(new Date(d.starts_at))}. {d.event_status_reason ?? d.removal_reason ?? ""}
        </Notice>
      ))}

      <nav aria-label="Duty lists" className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1 text-center text-sm sm:grid-cols-4">
        {TABS.map((t) => (
          <Link key={t.key} href={`/my-duties?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}
            className={`flex min-h-11 items-center justify-center rounded-lg px-2 font-semibold ${tab === t.key ? "bg-club text-white" : "text-club"}`}>
            {t.label} ({groups[t.key].length})
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-white p-4 text-ink-muted">
          {tab === "confirmed" ? <>No upcoming duties. <Link href="/rota" className="font-semibold text-club-blue underline">Find something on the rota</Link>.</> : null}
          {tab === "invited" ? "No invitations waiting for you." : null}
          {tab === "pending" ? "Nothing waiting for an organiser's approval." : null}
          {tab === "past" ? "No past duties yet." : null}
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((d) => <DutyItem key={d.assignment_id} d={d} now={now} />)}
        </ul>
      )}
    </section>
  );
}

function DutyItem({ d, now }: { d: MyDuty; now: number }) {
  const st = new Date(d.starts_at);
  const en = new Date(d.ends_at);
  const deadline = new Date(d.withdraw_deadline);
  const canWithdraw = now < deadline.getTime();
  const isPast = en.getTime() <= now;
  const active = d.status === "confirmed" || d.status === "pending_approval";

  return (
    <li className="rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{formatDay(st)}</span>
        <span className="font-mono text-sm tabular-nums">{formatRange(st, en)}</span>
        <DemoBadge show={d.is_demo} />
      </div>
      <p className="mt-1 font-semibold text-club">{d.duty_name}</p>
      <p className="text-sm">
        <Link href={`/rota/${d.event_id}`} className="text-club-blue underline">{d.event_title}</Link> · {d.venue_name}
      </p>
      {d.responsibilities.length ? <p className="text-sm text-ink-muted">Includes: {d.responsibilities.join(", ")}</p> : null}
      {d.shift_instructions ? <p className="mt-1 whitespace-pre-line text-sm">{d.shift_instructions}</p> : null}
      {d.event_status === "postponed" ? <p className="mt-1 text-sm font-semibold text-amber-900">⚠ Event postponed: {d.event_status_reason}</p> : null}

      {isPast ? (
        <p className="mt-2 text-sm text-ink-muted">
          {d.attendance_status === "present" ? "✓ Marked as attended. Thank you!" : d.attendance_status === "absent" ? "Marked as not attended." : "Attendance not recorded."}
        </p>
      ) : null}

      {d.status === "invited" && !isPast ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm">An organiser has asked if you can do this duty.{d.approval_required ? " An organiser will still confirm it after you accept." : ""}</p>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={acceptAction} submitLabel="Accept" pendingLabel="Accepting…" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="assignment_id" value={d.assignment_id} />
            </ActionForm>
            <ActionForm action={declineAction} submitLabel="Decline" pendingLabel="Declining…" variant="secondary" className="flex flex-wrap items-center gap-2"
              confirm="Decline this duty?">
              <input type="hidden" name="assignment_id" value={d.assignment_id} />
            </ActionForm>
          </div>
        </div>
      ) : null}

      {d.status === "pending_approval" && !isPast ? (
        <p className="mt-2 text-sm font-semibold text-club-blue">⏳ Awaiting organiser approval. Your place is held.</p>
      ) : null}

      {d.status === "confirmed" && !isPast ? (
        <p className="mt-2">
          <a href={`/my-duties/${d.assignment_id}/calendar`} className="text-sm font-semibold text-club-blue underline">Add to my calendar</a>
        </p>
      ) : null}

      {active && !isPast ? (
        <div className="mt-3 border-t border-line pt-3">
          {d.cancellation_pending ? (
            <p className="text-sm">You&apos;ve asked to cancel. The organisers will reply. Until then you&apos;re still down for this duty.</p>
          ) : canWithdraw ? (
            <ActionForm action={withdrawAction} submitLabel="Withdraw from this duty" pendingLabel="Withdrawing…" variant="danger"
              confirm="Withdraw from this duty? The place will be offered to someone else." className="space-y-2">
              <input type="hidden" name="assignment_id" value={d.assignment_id} />
              <p className="text-xs text-ink-muted">You can withdraw online until {formatDay(deadline)} {formatTime(deadline)}.</p>
            </ActionForm>
          ) : (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-danger">Can&apos;t make it?</summary>
              <ActionForm action={requestCancellationAction} submitLabel="Ask to cancel" pendingLabel="Sending…" variant="danger" className="mt-2 space-y-2">
                <input type="hidden" name="assignment_id" value={d.assignment_id} />
                <p className="text-xs text-ink-muted">It&apos;s too close to the duty to withdraw online. Your request goes straight to the organisers&apos; list of things to deal with. You stay on the duty until one of them replies.</p>
                <label className="block text-sm">
                  <span className="font-semibold">Reason (optional)</span>
                  <textarea name="reason" maxLength={500} rows={2} className="mt-1 block w-full rounded-lg border border-line px-3 py-2" />
                </label>
              </ActionForm>
            </details>
          )}
        </div>
      ) : null}
    </li>
  );
}
