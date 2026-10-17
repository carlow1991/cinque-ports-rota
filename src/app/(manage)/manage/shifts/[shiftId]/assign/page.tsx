import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Notice } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadPicker, loadRoster, loadShiftForAssign } from "@/lib/data/manage";
import { formatLongDay, formatRange } from "@/lib/time/london";
import { allocateAction } from "../../../events/actions";

export const metadata: Metadata = { title: "Invite a volunteer" };

export default function AssignPage({ params, searchParams }: PageProps<"/manage/shifts/[shiftId]/assign">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Assign params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Assign({ params, searchParams }: { params: PageProps<"/manage/shifts/[shiftId]/assign">["params"]; searchParams: PageProps<"/manage/shifts/[shiftId]/assign">["searchParams"] }) {
  await requireRole(MANAGER_ROLES);
  const { shiftId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(shiftId)) notFound();
  const info = await loadShiftForAssign(shiftId);
  if (!info) notFound();
  const [picker, roster] = await Promise.all([loadPicker(shiftId), loadRoster({ eventId: info.event.id })]);
  if (picker.length === 0) notFound(); // not this coordinator's venue (picker is venue-scoped)

  const onShift = new Map(roster.filter((r) => r.shift_id === shiftId && r.volunteer_id).map((r) => [r.volunteer_id!, r.status]));
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 60) : "";
  const list = picker.filter((p) => !q || p.display_name.toLowerCase().includes(q));
  // Best matches first: eligible and free, then clashes, then needs authorisation.
  const rank = (p: (typeof picker)[number]) => (onShift.has(p.volunteer_id) ? 3 : !p.eligible ? 2 : p.has_overlap ? 1 : 0);
  list.sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name));
  const st = info.staffing;
  const closed = info.shift.status !== "active" || !["published", "postponed"].includes(info.event.status);

  return (
    <section className="space-y-4">
      <p><Link href={`/manage/events/${info.event.id}#shift-${shiftId}`} className="text-sm font-semibold text-club-blue underline">← Back to {info.event.title}</Link></p>
      <header>
        <h1 className="text-2xl font-bold text-club">Invite a volunteer</h1>
        <p><strong>{info.dutyName}</strong> · {formatLongDay(new Date(info.shift.starts_at))} · {formatRange(new Date(info.shift.starts_at), new Date(info.shift.ends_at))}</p>
        {st ? <p className="text-sm">{st.confirmed_count}/{info.shift.required_count} confirmed{st.pending_count ? ` · ${st.pending_count} awaiting approval` : ""}{st.invited_count ? ` · ${st.invited_count} invited` : ""} · {st.open_slots} open</p> : null}
      </header>

      {closed ? <Notice tone="warn" title="Not open for invitations">Publish the event first. Invitations can&apos;t be sent for drafts or cancelled duties.</Notice> : null}
      <Notice tone="info">An invitation does not fill the place: it counts as cover only when the volunteer accepts (and, if the duty needs approval, once you approve it).</Notice>

      <form action={`/manage/shifts/${shiftId}/assign`} className="flex gap-2">
        <label className="sr-only" htmlFor="q">Search by name</label>
        <input id="q" name="q" defaultValue={q} placeholder="Search by name" className="min-h-11 flex-1 rounded-lg border border-line bg-white px-3" />
        <button className="min-h-11 rounded-lg border border-line bg-white px-4 font-semibold text-club">Search</button>
      </form>

      <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {list.map((p) => {
          const status = onShift.get(p.volunteer_id);
          return (
            <li key={p.volunteer_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div>
                <p className="font-semibold">{p.display_name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {status ? <Badge tone="good">{status === "confirmed" ? "Already confirmed" : status === "pending_approval" ? "Awaiting approval" : "Already invited"}</Badge> : null}
                  {!p.eligible ? <Badge tone="warn">Needs authorisation: {p.missing_authorisations.join(", ")}</Badge> : null}
                  {p.has_overlap ? <Badge tone="warn">Has another duty at this time</Badge> : null}
                  {!status && p.eligible && !p.has_overlap ? <Badge tone="good">Available</Badge> : null}
                </div>
              </div>
              {!status && p.eligible && !closed ? (
                <ActionForm action={allocateAction} submitLabel="Invite" pendingLabel="Inviting…" variant={p.has_overlap ? "secondary" : "primary"} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="shift_id" value={shiftId} />
                  <input type="hidden" name="volunteer_id" value={p.volunteer_id} />
                </ActionForm>
              ) : null}
            </li>
          );
        })}
        {list.length === 0 ? <li className="p-3 text-sm text-ink-muted">No volunteers match.</li> : null}
      </ul>
      <p className="text-xs text-ink-muted">Someone with another duty at the same time can be invited, but they can only accept if the times no longer clash.</p>
    </section>
  );
}
