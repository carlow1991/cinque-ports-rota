import { ActionForm } from "@/components/action-form";
import { Badge, Field, Input, Select } from "@/components/ui";
import { buildCards, type Involvement, type PersonCard } from "@/lib/domain/involvement";
import { formatPhone } from "@/lib/domain/hub-tags";
import { cancelAssignmentAction, expectedOverrideAction, markContactedAction, recordAssignmentResponseAction } from "@/app/(manage)/manage/events/involvement-actions";

/** Event involvement, one card per person, sections in the order of spec 03 §2 (/calendar/[id]). */
export function InvolvementSections({ inv, eventId, endKnown, manage }: { inv: Involvement; eventId: string; endKnown: boolean; manage: boolean }) {
  const sections = buildCards(inv, endKnown).filter((s) => manage || !["awaiting", "declined"].includes(s.section));
  if (sections.length === 0) return manage ? <p className="text-sm text-ink-muted">No one is involved yet. Nobody has been asked.</p> : null;
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <section key={s.section} aria-labelledby={`sec-${s.section}`}>
          <h2 id={`sec-${s.section}`} className="text-lg font-semibold text-club">{s.title} <span className="text-sm font-normal text-ink-muted">({s.cards.length})</span></h2>
          {s.section === "expected" ? <p className="text-xs text-ink-muted">Linked to the team. Expected isn&apos;t the same as confirmed.</p> : null}
          {s.section === "available" ? <p className="text-xs text-ink-muted">Offered to help. Not booked unless invited and accepted.</p> : null}
          <ul className="mt-2 space-y-2">{s.cards.map((c) => <Card key={c.person_id} c={c} eventId={eventId} manage={manage} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function Card({ c, eventId, manage }: { c: PersonCard; eventId: string; manage: boolean }) {
  const a = c.assignment;
  return (
    <li className="rounded-lg border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{c.name}</span>
        {c.badges.map((b, i) => <Badge key={i} tone={b.tone}>{b.text}</Badge>)}
      </div>
      {c.detail.filter(Boolean).map((d, i) => <p key={i} className="text-sm text-ink-muted">{d}</p>)}
      {manage && c.contact && (c.contact.email || c.contact.phone) ? (
        <p className="text-sm">
          {c.contact.phone ? <a className="text-club-blue underline" href={`tel:${c.contact.phone}`}>{formatPhone(c.contact.phone)}</a> : null}
          {c.contact.phone && c.contact.email ? " · " : null}
          {c.contact.email ? <a className="break-all text-club-blue underline" href={`mailto:${c.contact.email}`}>{c.contact.email}</a> : null}
        </p>
      ) : null}
      {manage ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {a && (a.state === "pending" || a.state === "needs_reconfirmation") ? (
            <>
              <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: they said yes" variant="secondary" className="" pendingLabel="Saving…">
                <input type="hidden" name="assignment_id" value={a.id} /><input type="hidden" name="accept" value="yes" />
              </ActionForm>
              <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: they said no" variant="secondary" className="" pendingLabel="Saving…">
                <input type="hidden" name="assignment_id" value={a.id} /><input type="hidden" name="accept" value="no" />
              </ActionForm>
            </>
          ) : null}
          {a && a.state !== "declined" && a.state !== "cancelled" ? (
            <ActionForm action={cancelAssignmentAction} submitLabel="Cancel request" variant="danger" className="" confirm={`Cancel ${c.name}'s request?`}>
              <input type="hidden" name="assignment_id" value={a.id} />
            </ActionForm>
          ) : null}
          {c.section === "awaiting" && !a ? (
            <ActionForm action={markContactedAction} submitLabel="I contacted them another way" variant="secondary" className="">
              <input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="person_id" value={c.person_id} />
            </ActionForm>
          ) : null}
          {c.expected ? (
            <details className="w-full">
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Change for this event only</summary>
              <ActionForm action={expectedOverrideAction} submitLabel="Save" variant="secondary">
                <input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="person_id" value={c.person_id} />
                <Field label="This event">
                  <Select name="override" defaultValue={c.expected.override ?? ""}>
                    <option value="">Expected by role (default)</option>
                    <option value="not_expected">Not expected this time</option>
                    <option value="confirmed_by_admin">Confirmed attending (recorded by me)</option>
                  </Select>
                </Field>
                <Field label="Note (optional)"><Input name="note" maxLength={300} defaultValue={c.expected.override_note ?? ""} /></Field>
              </ActionForm>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
