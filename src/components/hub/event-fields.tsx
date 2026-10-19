import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { CATEGORIES, type HubEvent } from "@/lib/domain/hub-calendar";
import { londonParts } from "@/lib/time/london";

type Opt = { id: string; name: string; active: boolean };

/**
 * Create/Edit Event (spec 03 /manage/events/new): five visible fields + one switch.
 * Everything else sits behind "More options". Inactive venues are offered only to an event already there.
 */
export function EventFields({ e, venues, teams, defaultDate }: { e?: HubEvent | null; venues: Opt[]; teams: { id: string; name: string }[]; defaultDate?: string }) {
  const s = e ? londonParts(new Date(e.starts_at)) : null;
  const end = e?.ends_at ? londonParts(new Date(e.ends_at)).time : "";
  const kick = e?.kickoff_at ? londonParts(new Date(e.kickoff_at)).time : "";
  const where = e ? (e.venue_id ?? "outside") : (venues.find((v) => v.active)?.id ?? "outside");
  const venueChoices = venues.filter((v) => v.active || v.id === e?.venue_id);
  return (
    <>
      <Field label="Event name (required)">
        <Input name="title" required maxLength={120} defaultValue={e?.title ?? ""} placeholder="e.g. Mini Kickers" autoComplete="off" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date (required)"><Input name="date" type="date" required defaultValue={s?.dateKey ?? defaultDate ?? ""} /></Field>
        <Field label="Start time (required)"><Input name="start" type="time" required defaultValue={s?.time ?? ""} /></Field>
        <Field label="Finish time" hint="Leave blank if not known — we won't guess it."><Input name="end" type="time" defaultValue={end} /></Field>
      </div>
      <Field label="Where? (required)">
        <Select name="where" defaultValue={where}>
          {venueChoices.map((v) => <option key={v.id} value={v.id}>{v.name}{v.active ? "" : " (inactive venue)"}</option>)}
          <option value="outside">Outside / away location (type below)</option>
        </Select>
      </Field>
      <Field label="Outside or away location" hint="Only used when “Outside / away location” is chosen. No venue is created.">
        <Input name="external_location_text" maxLength={200} defaultValue={e?.external_location_text ?? ""} placeholder="e.g. Charles Sports Ground, Deal" />
      </Field>
      <Checkbox name="volunteers_enabled" defaultChecked={e?.volunteers_enabled ?? false}
        label="Ask volunteers for availability?"
        hint="Lets members answer “Can you help?”. Nothing is sent: you choose who to ask, and press Send, afterwards." />
      <details className="rounded-lg border border-line p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">More options</summary>
        <div className="mt-2 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select name="category" defaultValue={e?.category ?? "other"}>{CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</Select>
            </Field>
            <Field label="Team">
              <Select name="team_id" defaultValue={e?.team_id ?? ""}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            </Field>
            <Field label="Kick-off (if different from the start)"><Input name="kickoff" type="time" defaultValue={kick} /></Field>
            <Field label="Opponent"><Input name="opponent" maxLength={120} defaultValue={e?.opponent ?? ""} /></Field>
            <Field label="Competition"><Input name="competition" maxLength={120} defaultValue={e?.competition ?? ""} /></Field>
          </div>
          <Field label="Notes"><Textarea name="description" maxLength={4000} defaultValue={e?.description ?? ""} /></Field>
          {!e ? (
            <Checkbox name="publish" label="Publish now" hint="Members see published events. Publishing sends nothing." defaultChecked />
          ) : null}
        </div>
      </details>
    </>
  );
}
