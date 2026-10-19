import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import { DUTY_TAGS } from "@/lib/domain/hub-tags";
import type { Candidate, PickerRow } from "@/lib/data/hub-involvement";
import { inviteToHelpAction, recordAvailabilityAction, requestAvailabilityAction } from "@/app/(manage)/manage/events/involvement-actions";

/** "Request availability": the organiser reviews and ticks recipients, then presses Send. */
export function RequestAvailabilityPanel({ eventId, candidates, open }: { eventId: string; candidates: Candidate[]; open: boolean }) {
  const notYet = candidates.filter((c) => !c.already_asked);
  return (
    <details id="request" className="rounded-xl border border-line bg-white p-3" open={open}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">Request availability</summary>
      <p className="text-sm text-ink-muted">People who usually get asked are ticked. Untick anyone, tick others, then press Send. Nothing goes until you do.</p>
      {notYet.length === 0 ? <p className="mt-2 text-sm">Everyone in the directory has already been asked.</p> : (
        <ActionForm action={requestAvailabilityAction} submitLabel="Send requests" pendingLabel="Sending…"
          confirm="Send an availability request to the ticked people?">
          <input type="hidden" name="event_id" value={eventId} />
          <div className="grid max-h-80 gap-x-4 overflow-y-auto sm:grid-cols-2">
            {notYet.map((c) => (
              <Checkbox key={c.person_id} name="person_ids" value={c.person_id} defaultChecked={c.suggested}
                label={c.name} hint={[c.reason, c.has_account ? null : "No Hub login — contact them yourself"].filter(Boolean).join(" · ") || undefined} />
            ))}
          </div>
        </ActionForm>
      )}
      {candidates.some((c) => c.already_asked) ? (
        <p className="mt-2 text-xs text-ink-muted">Already asked: {candidates.filter((c) => c.already_asked).map((c) => c.name).join(", ")}</p>
      ) : null}
    </details>
  );
}

function PersonSelect({ people }: { people: PickerRow[] }) {
  return (
    <Field label="Person">
      <Select name="person_id" required defaultValue="">
        <option value="" disabled>Choose a person</option>
        {people.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}{p.has_account ? "" : " (no Hub login)"}</option>)}
      </Select>
    </Field>
  );
}

/** "Invite / assign a person": optional responsibility and times; send a request or record an offline yes. */
export function InvitePanel({ eventId, people, canRequest }: { eventId: string; people: PickerRow[]; canRequest: boolean }) {
  return (
    <details id="invite" className="rounded-xl border border-line bg-white p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">Invite a person to help</summary>
      <ActionForm action={inviteToHelpAction} submitLabel="Save">
        <input type="hidden" name="event_id" value={eventId} />
        <PersonSelect people={people} />
        <Field label="Responsibility (optional)" hint="Pick one or type your own, e.g. Matchday support.">
          <Input name="label" list="duty-tags" maxLength={80} />
        </Field>
        <datalist id="duty-tags">{DUTY_TAGS.map((d) => <option key={d.code} value={d.label} />)}</datalist>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (optional)"><Input name="from" type="time" /></Field>
          <Field label="Until (optional)"><Input name="until" type="time" /></Field>
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">How</legend>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="mode" value="request" defaultChecked={canRequest} disabled={!canRequest} className="h-5 w-5" />
            <span>Send request — they accept or decline{canRequest ? "" : " (publish the event first)"}</span></label>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="mode" value="record_confirmed" defaultChecked={!canRequest} className="h-5 w-5" />
            <span>Record that they&apos;ve already agreed (e.g. by phone)</span></label>
        </fieldset>
      </ActionForm>
    </details>
  );
}

/** Record a Yes/No someone gave offline (labelled "Recorded by …"). */
export function RecordReplyPanel({ eventId, people }: { eventId: string; people: PickerRow[] }) {
  return (
    <details id="record" className="rounded-xl border border-line bg-white p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-club">Record someone&apos;s availability</summary>
      <p className="text-sm text-ink-muted">For people who told you in person or by phone. Shown as recorded by you.</p>
      <ActionForm action={recordAvailabilityAction} submitLabel="Record">
        <input type="hidden" name="event_id" value={eventId} />
        <PersonSelect people={people} />
        <Field label="Their answer"><Select name="response" defaultValue="yes"><option value="yes">Yes, can help</option><option value="no">No, can&apos;t help</option></Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From (optional)"><Input name="from" type="time" /></Field>
          <Field label="Until (optional)"><Input name="until" type="time" /></Field>
        </div>
      </ActionForm>
    </details>
  );
}
