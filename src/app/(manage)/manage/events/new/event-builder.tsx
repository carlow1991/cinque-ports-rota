"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Card, Checkbox, Field, FormMessage, Input, Notice, Select, Textarea, EVENT_TYPE_LABEL } from "@/components/ui";
import { describeOffset, expandTemplate } from "@/lib/domain/templates";
import { coverFit, requiredWindow } from "@/lib/domain/cover-fit";
import { formatRange, londonWindow, zoneLabel } from "@/lib/time/london";
import type { CoverageOption, Team, Template, Venue } from "@/lib/data/manage";
import { useHydrated } from "@/lib/use-hydrated";
import { createEventAction } from "../actions";

type Props = { venues: Venue[]; teams: Team[]; templates: Template[]; coverageEvents: CoverageOption[]; today: string };

const REASONS = { not_enabled: "not switched on", covered_by_linked_venue_cover: "covered by the linked venue-wide cover", already_generated: "already on the event" } as const;

export function EventBuilder({ venues, teams, templates, coverageEvents, today }: Props) {
  const [result, action, pending] = useActionState(createEventAction, null);
  const ready = useHydrated();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [type, setType] = useState("fixture");
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("15:00");
  const [end, setEnd] = useState("16:45");
  const [coverId, setCoverId] = useState("");
  const [siteResp, setSiteResp] = useState(true);

  const usable = useMemo(
    () => templates
      .filter((t) => !t.venue_id || t.venue_id === venueId)
      .sort((a, b) => Number(b.event_type === type) - Number(a.event_type === type) || a.code.localeCompare(b.code)),
    [templates, venueId, type],
  );
  const [templateId, setTemplateId] = useState(usable[0]?.id ?? "");
  const template = usable.find((t) => t.id === templateId) ?? null;
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(template?.items.filter((i) => i.enabledByDefault).map((i) => i.id)));
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [templateNote, setTemplateNote] = useState("");
  // Have they changed the template's suggested duties or numbers? Then switching template loses work.
  const adjusted = Boolean(template) && (Object.keys(counts).length > 0 ||
    template!.items.some((i) => enabled.has(i.id) !== i.enabledByDefault));

  function chooseTemplate(id: string, opts: { force?: boolean } = {}) {
    if (!opts.force && adjusted && id !== templateId &&
        !window.confirm("Switch template? The changes you made to the duties below will be lost.")) return;
    setTemplateNote("");
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    setEnabled(new Set(t?.items.filter((i) => i.enabledByDefault).map((i) => i.id)));
    setCounts({});
  }
  function chooseVenue(id: string) {
    setVenueId(id);
    setCoverId("");
    if (template?.venue_id && template.venue_id !== id) {
      const vName = venues.find((v) => v.id === template.venue_id)?.name ?? "another venue";
      chooseTemplate("", { force: true });
      setTemplateNote(`“${template.code}: ${template.name}” is only for ${vName}, so it no longer applies. Choose a template for this venue, or add duties by hand after creating the draft.`);
    }
  }

  const w = londonWindow(date, start, end);
  const coverOptions = coverageEvents.filter((c) => c.venue_id === venueId && type !== "venue_coverage");
  const preview = template && w.ok
    ? expandTemplate({ startsAt: w.startsAt, endsAt: w.endsAt, linkedToVenueCover: Boolean(coverId) }, template.items, { enabled, counts })
    : null;
  const leadPlanned = preview?.shifts.some((s) => s.dutyCode === "site_lead");
  // Actual clock times for every template duty at the chosen date/time (shown next to each one).
  const timesByItem = new Map(template && w.ok
    ? expandTemplate({ startsAt: w.startsAt, endsAt: w.endsAt, linkedToVenueCover: false }, template.items,
        { enabled: new Set(template.items.map((i) => i.id)), counts }).shifts.map((x) => [x.itemId, formatRange(x.startsAt, x.endsAt)])
    : []);
  const needsDecision = siteResp && !coverId && !leadPlanned;
  // How well each venue-cover event's planned time spans this event plus its setup/clean-up duties.
  const need = w.ok ? requiredWindow({ starts_at: w.startsAt.toISOString(), ends_at: w.endsAt.toISOString() },
    (preview?.shifts ?? []).map((x) => ({ starts_at: x.startsAt.toISOString(), ends_at: x.endsAt.toISOString() }))) : null;
  const fitText = (c: CoverageOption) => {
    if (!need) return "";
    const f = coverFit(need, c);
    return f.kind === "whole" ? ", covers the whole time" : f.kind === "none" ? ", doesn't overlap"
      : `, misses ${f.missing.map((m) => formatRange(new Date(m.start), new Date(m.end))).join(" and ")}`;
  };

  return (
    <form action={action} className="space-y-4">
      <Card title="1. What and where">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Venue">
            <Select name="venue_id" value={venueId} onChange={(e) => chooseVenue(e.target.value)} required>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select name="event_type" value={type} onChange={(e) => { setType(e.target.value); if (e.target.value === "venue_coverage") setCoverId(""); }}>
              {Object.entries(EVENT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Title" hint='e.g. "First Team v Hythe Town" or "Freemens Way Saturday operations"'>
            <Input name="title" required maxLength={120} />
          </Field>
          <Field label="Team (optional)" hint={teams.some((t) => t.active) ? undefined : "No teams are set up yet. An administrator can add the club's teams in Setup → Settings."}>
            <Select name="team_id" defaultValue="">
              <option value="">None</option>
              {teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          {type === "fixture" ? (
            <>
              <Field label="Opponent (optional)"><Input name="opponent" maxLength={120} /></Field>
              <Field label="Competition (optional)"><Input name="competition" maxLength={120} /></Field>
            </>
          ) : null}
        </div>
      </Card>

      <Card title="2. When (UK time)">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Date"><Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Event start" hint="When the event itself starts. Duties before and after are timed from this and the end.">
            <Input type="time" name="start" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Event end" hint="A realistic finish time. Clean-up duties are timed from this.">
            <Input type="time" name="end" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
          {type === "fixture" ? (
            <Field label="Kick-off (optional)" hint="For information only. It doesn't move any duty times."><Input type="time" name="kickoff" /></Field>
          ) : null}
        </div>
        <div className="mt-2 text-sm" aria-live="polite">
          {w.ok ? (
            <p>
              {formatRange(w.startsAt, w.endsAt)} {zoneLabel(w.startsAt)}
              {w.crossesMidnight ? " · runs past midnight" : ""}
              {w.ambiguous ? " · ⚠ that time happens twice when the clocks go back; the first (BST) one is used" : ""}
            </p>
          ) : (
            <p role="alert" className="font-medium text-danger">{w.error}</p>
          )}
        </div>
      </Card>

      <Card title="3. Site responsibility">
        <Checkbox name="site_responsibility" checked={siteResp} onChange={(e) => setSiteResp(e.target.checked)}
          label="The club is responsible for opening, running and locking the site"
          hint="Untick only if the facility is fully managed by someone else (an admin can record provider cover on the event page)." />
        {type !== "venue_coverage" ? (
          <div className="mt-3">
            <Field label="Use venue-wide cover (optional)" hint="Link to a same-venue cover event so this event doesn't get its own site lead. Linking is not proof of cover: the event page shows whether a confirmed lead covers the whole window.">
              <Select name="coverage_event_id" value={coverId} onChange={(e) => setCoverId(e.target.value)}>
                <option value="">No, not linked</option>
                {coverOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({new Date(c.starts_at).toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })}, {formatRange(new Date(c.starts_at), new Date(c.ends_at))}{fitText(c)})
                  </option>
                ))}
              </Select>
            </Field>
            {coverOptions.length === 0 ? <p className="mt-1 text-xs text-ink-muted">No venue-cover events at this venue in the coming weeks. Create one with type &ldquo;Venue cover&rdquo; (template T06 or T09).</p> : null}
          </div>
        ) : null}
      </Card>

      <Card title="4. Duties">
        <Field label="Template">
          <Select name="template_id" value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
            <option value="">No template: I&apos;ll add duties by hand</option>
            {usable.map((t) => <option key={t.id} value={t.id}>{t.code}: {t.name}{t.event_type === type ? "" : ` (${EVENT_TYPE_LABEL[t.event_type]})`}</option>)}
          </Select>
        </Field>
        {templateNote ? <p role="status" className="mt-2 text-sm font-medium text-amber-800">{templateNote}</p> : null}
        {template?.description ? <p className="mt-2 text-sm text-ink-muted">{template.description}</p> : null}

        {template ? (
          <fieldset className="mt-3 space-y-2">
            <legend className="text-sm font-semibold">Which duties are needed? Suggested numbers: adjust for this event.</legend>
            {template.items.map((i) => {
              const on = enabled.has(i.id);
              const suppressed = i.suppressedByLinkedCover && Boolean(coverId);
              return (
                <div key={i.id} className={`rounded-lg border p-3 ${on && !suppressed ? "border-club/40 bg-blue-50/40" : "border-line"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Checkbox name="enabled" value={i.id} checked={on}
                      onChange={(e) => setEnabled((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })}
                      label={<>{i.dutyName}{i.enabledByDefault ? "" : <span className="ml-1 text-xs font-normal text-ink-muted">(optional)</span>}</>}
                      hint={<>
                        {timesByItem.get(i.id) ? <strong className="font-mono tabular-nums">{timesByItem.get(i.id)} </strong> : null}
                        <span>({describeOffset(i.startAnchor, i.startOffsetMinutes)} → {describeOffset(i.endAnchor, i.endOffsetMinutes)})</span>
                        {i.whenToEnable ? <span className="block">{i.whenToEnable}</span> : null}
                      </>} />
                    <label className="flex items-center gap-2 text-sm">
                      <span>People</span>
                      <input type="number" name={`count_${i.id}`} min={1} max={50} inputMode="numeric" disabled={!on}
                        value={counts[i.id] ?? i.requiredCount}
                        onChange={(e) => setCounts((c) => ({ ...c, [i.id]: Number(e.target.value) }))}
                        className="w-16 rounded-lg border border-line px-2 py-1 text-center" />
                    </label>
                  </div>
                  {i.responsibilities.length ? (
                    <p className="ml-8 text-xs text-ink-muted">Includes: {i.responsibilities.map((r) => r.name).join(", ")} (one person, one place)</p>
                  ) : null}
                  {suppressed && on ? <p className="ml-8 text-xs font-medium text-club-blue">Not created: the linked venue-wide cover provides the site lead.</p> : null}
                </div>
              );
            })}
          </fieldset>
        ) : null}
      </Card>

      {preview ? (
        <Card title="Preview">
          <p className="mb-2 text-sm"><strong>{preview.rows}</strong> duty row(s), <strong>{preview.slots}</strong> place(s) to fill. Not the number of people needed at once.</p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {preview.shifts.map((s) => (
              <li key={s.itemId} className="flex flex-wrap items-baseline justify-between gap-2 p-2 text-sm">
                <span>
                  <strong>{s.dutyName}</strong>
                  {s.responsibilities.length ? <span className="text-ink-muted"> + {s.responsibilities.map((r) => r.name.toLowerCase()).join(", ")}</span> : null}
                </span>
                <span className="font-mono tabular-nums">{formatRange(s.startsAt, s.endsAt)} · {s.requiredCount} {s.requiredCount === 1 ? "person" : "people"}</span>
              </li>
            ))}
            {preview.shifts.length === 0 ? <li className="p-2 text-sm text-ink-muted">No duties will be created.</li> : null}
          </ul>
          {preview.skipped.length ? (
            <p className="mt-2 text-xs text-ink-muted">Not created: {preview.skipped.map((s) => `${s.dutyName} (${REASONS[s.reason]})`).join("; ")}.</p>
          ) : null}
          {preview.problems.length ? <Notice tone="bad" title="Fix before creating">{preview.problems.join(" ")}</Notice> : null}
        </Card>
      ) : null}

      {needsDecision ? (
        <Notice tone="warn" title="Site cover decision needed before publishing">
          The club is responsible for this site but there is no site-lead duty and no linked venue cover. You can save the draft now, but it
          can&apos;t be published until a site lead is added, cover is linked, or an admin records provider cover.
        </Notice>
      ) : null}

      <Card title="5. Notes (optional)">
        <div className="grid gap-3">
          <Field label="Description (visible to volunteers)"><Textarea name="description" maxLength={4000} /></Field>
          <Field label="Instructions for volunteers" hint="Where to meet, what to bring. Don't include cash or key-safe details here."><Textarea name="instructions" maxLength={4000} /></Field>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-white px-4 py-3">
        <Button type="submit" disabled={pending || !ready || !w.ok || Boolean(preview?.problems.length)}>{pending ? "Creating…" : "Create draft event"}</Button>
        <span className="text-sm text-ink-muted">Saved as a draft. Volunteers see it only after you publish.</span>
        <FormMessage result={result} />
      </div>
    </form>
  );
}
