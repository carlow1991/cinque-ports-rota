import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { ALL_INTERESTS, COMMITMENT_BUCKETS, COMMITMENT_PATTERNS, DAYPARTS, DAYS, INVOLVEMENT, LOCATION_PREFS, STRENGTHS, formatPhone } from "@/lib/domain/hub-tags";
import type { PersonFull, Preferences, UsualSlot } from "@/lib/data/hub";

/** Name and contact: always visible on Add Person (spec 03 /manage/people/new). */
export function PersonCoreFields({ p }: { p?: Partial<PersonFull> }) {
  return (
    <>
      <Field label="Name (required)">
        <Input name="full_name" required maxLength={120} defaultValue={p?.full_name ?? ""} autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email (optional)" hint="Needed only if they'll get a portal invitation or emails.">
          <Input name="email" type="email" maxLength={254} defaultValue={p?.email_normalized ?? ""} autoComplete="off" />
        </Field>
        <Field label="Telephone (optional)">
          <Input name="phone" type="tel" inputMode="tel" maxLength={30} defaultValue={formatPhone(p?.phone_normalized)} autoComplete="off" />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Involvement</legend>
        <div className="flex flex-wrap gap-x-4">
          {INVOLVEMENT.map((i) => (
            <Checkbox key={i.code} name="involvement" value={i.code} label={i.label} defaultChecked={(Array.isArray(p?.involvement) ? p.involvement : []).includes(i.code)} />
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Less-used details, behind a disclosure (progressive disclosure, spec 03 §1). */
export function PersonMoreFields({ p, open = false }: { p?: Partial<PersonFull>; open?: boolean }) {
  return (
    <details className="rounded-lg border border-line p-3" open={open}>
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">More details (optional)</summary>
      <div className="mt-2 space-y-3">
        <Field label="Name shown in the Hub" hint="Leave blank to use their full name.">
          <Input name="display_name" maxLength={80} defaultValue={p?.display_name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Preferred way to contact">
          <Select name="preferred_contact_channel" defaultValue={p?.preferred_contact_channel ?? ""}>
            <option value="">No preference</option>
            <option value="email">Email</option>
            <option value="phone">Phone call</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
        </Field>
        <Field label="Directory listing" hint="Even when listed, contact details stay hidden from members unless shared below.">
          <Select name="directory_visibility" defaultValue={p?.directory_visibility ?? "members"}>
            <option value="members">List name, teams and club roles to signed-in members</option>
            <option value="private">Don&apos;t list to members (organisers only)</option>
          </Select>
        </Field>
        <Checkbox name="share_email_with_members" label="Share email with signed-in members" defaultChecked={p?.share_email_with_members ?? false} />
        <Checkbox name="share_phone_with_members" label="Share phone with signed-in members" defaultChecked={p?.share_phone_with_members ?? false} />
        <Checkbox name="is_under_18" label="Under 18" hint="Never listed to members, contacts never shared, no portal invitation." defaultChecked={p?.is_under_18 ?? false} />
        <Field label="Private notes (administrators only)">
          <Textarea name="notes_private" maxLength={2000} defaultValue={p?.notes_private ?? ""} />
        </Field>
      </div>
    </details>
  );
}

/** Interests, strengths, commitment and usual weekly availability (a preference, never an RSVP). */
export function PreferencesFields({ prefs, slots, mine = false }: { prefs: Preferences | null; slots: UsualSlot[]; mine?: boolean }) {
  const has = (d: number, part: string) => slots.some((s) => s.day_of_week === d && s.daypart === part);
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold">{mine ? "What would you enjoy helping with?" : "Interests"}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {ALL_INTERESTS.map((i) => (
            <Checkbox key={i.code} name="interests" value={i.code} label={i.label} defaultChecked={(prefs?.interests ?? []).includes(i.code)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold">Strengths</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {STRENGTHS.map((s) => (
            <Checkbox key={s.code} name="strengths" value={s.code} label={s.label} defaultChecked={(prefs?.strengths ?? []).includes(s.code)} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Time each month">
          <Select name="commitment_bucket" defaultValue={prefs?.commitment_bucket ?? ""}>
            <option value="">Not said</option>
            {COMMITMENT_BUCKETS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Type of involvement">
          <Select name="commitment_pattern" defaultValue={prefs?.commitment_pattern ?? ""}>
            <option value="">Not said</option>
            {COMMITMENT_PATTERNS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Where">
          <Select name="location_preference" defaultValue={prefs?.location_preference ?? ""}>
            <option value="">Not said</option>
            {LOCATION_PREFS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Happy to learn or shadow?">
          <Select name="willing_to_learn" defaultValue={prefs?.willing_to_learn ?? ""}>
            <option value="">Not said</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option>
          </Select>
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Usually available</legend>
        <p className="text-xs text-ink-muted">A general guide only. It never signs anyone up for an event.</p>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr><th className="sr-only">Day</th>{DAYPARTS.map((d) => <th key={d.code} scope="col" className="px-1 py-1 text-left font-semibold">{d.label}</th>)}</tr>
          </thead>
          <tbody>
            {DAYS.map((day, i) => (
              <tr key={day} className="border-t border-line">
                <th scope="row" className="py-1 pr-2 text-left font-semibold">{day}</th>
                {DAYPARTS.map((d) => (
                  <td key={d.code} className="px-1">
                    <label className="flex min-h-11 items-center">
                      <input type="checkbox" name="slot" value={`${i}-${d.code}`} defaultChecked={has(i, d.code)} className="h-5 w-5 accent-[var(--club-primary)]" />
                      <span className="sr-only">{day} {d.label}</span>
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <Field label={mine ? "Anything else about how you'd like to help (optional)" : "Notes about their volunteering (optional)"}>
        <Textarea name="free_text" maxLength={1000} defaultValue={prefs?.free_text ?? ""} />
      </Field>
    </div>
  );
}
