import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { ALL_INTERESTS } from "@/lib/domain/hub-tags";
import type { Position } from "@/lib/data/hub";
import type { PickerRow } from "@/lib/data/hub-involvement";

export function PositionFields({ p, people }: { p?: Position; people: PickerRow[] }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title (required)"><Input name="title" required maxLength={100} defaultValue={p?.title ?? ""} /></Field>
        <Field label="Department"><Input name="department" maxLength={60} defaultValue={p?.department ?? ""} placeholder="e.g. Administration" /></Field>
      </div>
      <Field label="Short public description" hint="Shown on the public volunteer page if you advertise the role. No names or contact details.">
        <Textarea name="public_summary" maxLength={1000} defaultValue={p?.public_summary ?? ""} />
      </Field>
      <details className="rounded-lg border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">More details</summary>
        <div className="mt-2 space-y-3">
          <Field label="Key responsibilities"><Textarea name="responsibilities" maxLength={3000} defaultValue={p?.responsibilities ?? ""} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Time commitment"><Input name="estimated_commitment" maxLength={200} defaultValue={p?.estimated_commitment ?? ""} placeholder="e.g. 2–3 hours a week" /></Field>
            <Field label="Where">
              <Select name="work_location_preference" defaultValue={p?.work_location_preference ?? ""}>
                <option value="">Not said</option><option value="onsite">On site</option><option value="remote">From home</option><option value="either">Either</option>
              </Select>
            </Field>
            <Field label="Skills needed (comma separated)"><Input name="skills_required" defaultValue={p?.skills_required.join(", ") ?? ""} /></Field>
            <Field label="Skills that help (comma separated)"><Input name="skills_desirable" defaultValue={p?.skills_desirable.join(", ") ?? ""} /></Field>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold">Matches these volunteer interests</legend>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {ALL_INTERESTS.map((i) => <Checkbox key={i.code} name="interest_tags" value={i.code} label={i.label} defaultChecked={p?.interest_tags.includes(i.code) ?? false} />)}
            </div>
          </fieldset>
          <Checkbox name="training_available" label="Training or handover available" defaultChecked={p?.training_available ?? false} />
          <Checkbox name="requires_external_safeguarding_review" label="Needs external checks (e.g. FA safer recruitment / DBS)"
            hint="The Hub never records checks. Anyone suggested for this role is flagged for a human decision." defaultChecked={p?.requires_external_safeguarding_review ?? false} />
          <Field label="Who interested people should talk to">
            <Select name="recruiting_contact_person_id" defaultValue={p?.recruiting_contact_person_id ?? ""}>
              <option value="">Not set</option>{people.map((x) => <option key={x.person_id} value={x.person_id}>{x.name}</option>)}
            </Select>
          </Field>
        </div>
      </details>
      <Checkbox name="public_visible" label="Can appear on the public volunteer page" hint="It only appears there while it's recruiting (successor, extra help or an advertised vacancy)." defaultChecked={p?.public_visible ?? false} />
      {p ? <Checkbox name="active" label="Role in use" defaultChecked={p.active} /> : null}
    </>
  );
}
