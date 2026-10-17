import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Input } from "@/components/ui";
import type { RosterRow } from "@/lib/data/manage";
import { approveAction, attendanceAction, rejectAction, removeAction, resolveCancellationAction } from "../actions";

const STATUS: Record<string, [Parameters<typeof Badge>[0]["tone"], string]> = {
  confirmed: ["good", "Confirmed"],
  pending_approval: ["info", "Awaiting your approval"],
  invited: ["neutral", "Invited, not counted"],
};
const ATTENDANCE: Record<string, string> = { present: "Present", absent: "Absent", not_recorded: "Not recorded" };

/** The people on one duty, with the organiser actions that apply to each. Phone shown for organisers only. */
export function ShiftPeople({ shiftId, rows, started, open }: { shiftId: string; rows: RosterRow[]; started: boolean; open: boolean }) {
  const people = rows.filter((r) => r.assignment_id);
  return (
    <div className="mt-2 space-y-2">
      {people.length === 0 ? <p className="text-sm text-ink-muted">Nobody yet.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {people.map((p) => {
            const [tone, label] = STATUS[p.status ?? ""] ?? ["neutral", p.status ?? ""];
            return (
              <li key={p.assignment_id} className="space-y-2 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.display_name}</span>
                  <Badge tone={tone}>{label}</Badge>
                  {p.source === "admin_allocation" ? <span className="text-xs text-ink-muted">(invited by organiser)</span> : null}
                  {p.phone ? <a href={`tel:${p.phone.replace(/[^+0-9]/g, "")}`} className="text-club-blue underline">{p.phone}</a> : null}
                </div>

                {p.cancellation_request_id ? (
                  <div className="rounded-md border border-amber-600/40 bg-amber-50 p-2">
                    <p className="font-semibold text-amber-900">⚠ Asked to cancel{p.cancellation_reason ? `: "${p.cancellation_reason}"` : ""}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <ActionForm action={resolveCancellationAction} submitLabel="Let them cancel" variant="secondary" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="request_id" value={p.cancellation_request_id} />
                        <input type="hidden" name="decision" value="approve" />
                      </ActionForm>
                      <ActionForm action={resolveCancellationAction} submitLabel="Keep them on" variant="secondary" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="request_id" value={p.cancellation_request_id} />
                        <input type="hidden" name="decision" value="decline" />
                      </ActionForm>
                    </div>
                  </div>
                ) : null}

                {p.status === "pending_approval" && open ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={approveAction} submitLabel="Approve" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="assignment_id" value={p.assignment_id!} />
                    </ActionForm>
                    <ActionForm action={rejectAction} submitLabel="Decline" variant="secondary" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="assignment_id" value={p.assignment_id!} />
                    </ActionForm>
                  </div>
                ) : null}

                {p.status === "confirmed" && started ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-muted">Attendance: <strong>{ATTENDANCE[p.attendance_status ?? "not_recorded"]}</strong></span>
                    {(["present", "absent"] as const).filter((a) => a !== p.attendance_status).map((a) => (
                      <ActionForm key={a} action={attendanceAction} submitLabel={a === "present" ? "Mark present" : "Mark absent"} variant="secondary" className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="assignment_id" value={p.assignment_id!} />
                        <input type="hidden" name="attendance" value={a} />
                      </ActionForm>
                    ))}
                  </div>
                ) : null}

                {open && !started ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-danger">Remove from duty</summary>
                    <ActionForm action={removeAction} submitLabel="Remove" variant="danger" className="mt-1 space-y-2"
                      confirm={`Remove ${p.display_name} from this duty?`}>
                      <input type="hidden" name="assignment_id" value={p.assignment_id!} />
                      <Field label="Reason (they will see this)"><Input name="reason" required maxLength={500} /></Field>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {open && !started ? (
        <Link href={`/manage/shifts/${shiftId}/assign`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold text-club hover:bg-surface-muted">
          + Invite a volunteer
        </Link>
      ) : null}
    </div>
  );
}
