import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadVenues } from "@/lib/data/hub";
import { loadCoverPreview, loadPicker, loadVenueCovers, type VenueCoverRow } from "@/lib/data/hub-involvement";
import { eventTimeLabel, eventWindow } from "@/lib/domain/hub-calendar";
import { DUTY_TAGS, formatPhone } from "@/lib/domain/hub-tags";
import { alsoSupports } from "@/lib/domain/venue-cover";
import { addDays, formatDateKey, formatTime, isDateKey, isWallTime, londonParts, startOfLondonDay, todayKey } from "@/lib/time/london";
import { cancelAssignmentAction, recordAssignmentResponseAction } from "../events/involvement-actions";
import { createCoverAction, updateCoverAction } from "./actions";

export const metadata: Metadata = { title: "Shared venue cover" };

const COVER_LABELS = ["Café", "Refreshments / tea bar", "Open and unlock facilities", "Lock and secure facilities", "Site lead / duty manager", "Gate / admission collection", "General volunteer support"];

export default function VenueCoverPage(props: PageProps<"/manage/venue-cover">) {
  return <Suspense fallback={<PageLoading />}><VenueCover {...props} /></Suspense>;
}

async function VenueCover({ searchParams }: PageProps<"/manage/venue-cover">) {
  await requireLevel(HUB_MANAGERS);
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = todayKey();
  const [venues, people, covers] = await Promise.all([
    loadVenues(), loadPicker(), loadVenueCovers(startOfLondonDay(today), startOfLondonDay(addDays(today, 42)))]);
  const active = venues.filter((v) => v.active);
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  // Derived preview (nothing is linked): events this cover would sit alongside, and clashes.
  const pDate = isDateKey(s("date")) ? s("date") : "", pVenue = z.uuid().safeParse(s("venue")).success ? s("venue") : (active[0]?.id ?? "");
  const pFrom = isWallTime(s("from")) ? s("from") : "", pUntil = isWallTime(s("until")) ? s("until") : "";
  const pPerson = z.uuid().safeParse(s("person")).success ? s("person") : "";
  const w = pDate && pFrom && pUntil ? eventWindow({ date: pDate, start: pFrom, end: pUntil }) : null;
  const preview = w && w.ok && pVenue ? await loadCoverPreview(pVenue, w.startsAt, w.endsAt!, pPerson || null) : null;
  const byDay = new Map<string, VenueCoverRow[]>();
  for (const c of covers.filter((c) => c.can_manage)) {
    const k = londonParts(new Date(c.begins_at)).dateKey;
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }

  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Shared venue cover</h1>
      <p className="text-sm text-ink-muted">One person covering a venue for a time window — café, opening up, locking up — however many events overlap. It&apos;s saved once and shown alongside every overlapping event.</p>

      <Card title="Arrange cover">
        <form className="space-y-3" aria-label="Preview">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Date"><Input name="date" type="date" defaultValue={pDate} required /></Field>
            <Field label="From"><Input name="from" type="time" defaultValue={pFrom} required /></Field>
            <Field label="Until"><Input name="until" type="time" defaultValue={pUntil} required /></Field>
            <Field label="Venue"><Select name="venue" defaultValue={pVenue}>{active.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
          </div>
          <Field label="Person (optional, to check for clashes)">
            <Select name="person" defaultValue={pPerson}><option value="">—</option>{people.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}</option>)}</Select>
          </Field>
          <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Show overlapping events</button>
        </form>
        {w && !w.ok ? <Notice tone="bad">{w.error}</Notice> : null}
        {preview ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-semibold">It will appear alongside these events during the overlapping times:</p>
            {preview.events.length === 0 ? <p className="text-sm text-ink-muted">No club events overlap that window yet.</p> : (
              <ul className="list-disc pl-5 text-sm">{preview.events.map((e) => (
                <li key={e.id}>{e.title} · {eventTimeLabel({ ...e, kickoff_at: null })} — {e.coverage === "full" ? "whole event" : e.coverage === "partial" ? "part of it" : "at kick-off only (finish not recorded)"}</li>
              ))}</ul>
            )}
            {preview.conflicts.length ? (
              <Notice tone="warn" title="Clash">They&apos;re already needed elsewhere: {preview.conflicts.map((c) => `${c.what} at ${c.where} ${formatTime(new Date(c.starts_at))}–${formatTime(new Date(c.ends_at))}`).join("; ")}. Change the times, or save with a note.</Notice>
            ) : null}
          </div>
        ) : null}

        <ActionForm action={createCoverAction} submitLabel="Save cover" className="mt-4 space-y-3 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Date"><Input name="date" type="date" defaultValue={pDate} required /></Field>
            <Field label="From"><Input name="from" type="time" defaultValue={pFrom} required /></Field>
            <Field label="Until"><Input name="until" type="time" defaultValue={pUntil} required /></Field>
            <Field label="Venue"><Select name="venue_id" defaultValue={pVenue}>{active.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Person">
              <Select name="person_id" required defaultValue={pPerson}><option value="" disabled>Choose a person</option>{people.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}{p.has_account ? "" : " (no Hub login)"}</option>)}</Select>
            </Field>
            <Field label="Responsibility"><Input name="label" list="cover-labels" maxLength={80} placeholder="e.g. Café" /></Field>
          </div>
          <datalist id="cover-labels">{[...new Set([...COVER_LABELS, ...DUTY_TAGS.map((d) => d.label)])].map((l) => <option key={l} value={l} />)}</datalist>
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">How</legend>
            <label className="flex min-h-11 items-center gap-3"><input type="radio" name="mode" value="request" defaultChecked className="h-5 w-5" /><span>Send request — they accept or decline</span></label>
            <label className="flex min-h-11 items-center gap-3"><input type="radio" name="mode" value="record_confirmed" className="h-5 w-5" /><span>Record that they&apos;ve already agreed</span></label>
          </fieldset>
          <Field label="If there's a clash: why it's fine (optional)" hint="Only needed when they're already booked somewhere else at the same time.">
            <Input name="override_note" maxLength={500} />
          </Field>
        </ActionForm>
      </Card>

      <h2 className="text-lg font-bold text-club">Next six weeks</h2>
      {byDay.size === 0 ? <Card><p className="text-sm">No venue cover arranged.</p></Card> : [...byDay.entries()].map(([day, list]) => (
        <section key={day} aria-label={formatDateKey(day)} className="space-y-2">
          <h3 className="font-bold text-club">{formatDateKey(day)}</h3>
          {list.map((c) => (
            <article key={c.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                <span className="text-sm">{c.label ?? "Venue cover"} · {formatTime(new Date(c.begins_at))}–{formatTime(new Date(c.ends_at))} · {venueName.get(c.venue_id)}</span>
                <Badge tone={c.state === "confirmed" ? "good" : c.state === "declined" ? "neutral" : "warn"}>
                  {c.state === "confirmed" ? (c.response_source === "admin_recorded" ? "Confirmed — recorded by organiser" : "Confirmed") : c.state === "pending" ? "Awaiting reply" : c.state === "needs_reconfirmation" ? "Needs to reconfirm" : "Declined"}
                </Badge>
              </div>
              <p className="text-xs text-ink-muted">{alsoSupports(c.events)}{c.phone ? ` · ${formatPhone(c.phone)}` : ""}</p>
              {c.conflict_override_note ? <p className="text-xs text-amber-900">Clash accepted: {c.conflict_override_note}</p> : null}
              {c.state !== "declined" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.state === "pending" || c.state === "needs_reconfirmation" ? (
                    <>
                      <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: yes" variant="secondary" className=""><input type="hidden" name="assignment_id" value={c.id} /><input type="hidden" name="accept" value="yes" /></ActionForm>
                      <ActionForm action={recordAssignmentResponseAction} submitLabel="Record: no" variant="secondary" className=""><input type="hidden" name="assignment_id" value={c.id} /><input type="hidden" name="accept" value="no" /></ActionForm>
                    </>
                  ) : null}
                  <ActionForm action={cancelAssignmentAction} submitLabel="Cancel cover" variant="danger" className="" confirm="Cancel this cover? It disappears from every event at once.">
                    <input type="hidden" name="assignment_id" value={c.id} />
                  </ActionForm>
                  <details className="w-full">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Change times</summary>
                    <ActionForm action={updateCoverAction} submitLabel="Save change" variant="secondary">
                      <input type="hidden" name="assignment_id" value={c.id} />
                      <input type="hidden" name="date" value={day} />
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="From"><Input name="from" type="time" defaultValue={formatTime(new Date(c.begins_at))} required /></Field>
                        <Field label="Until"><Input name="until" type="time" defaultValue={formatTime(new Date(c.ends_at))} required /></Field>
                        <Field label="Responsibility"><Input name="label" defaultValue={c.label ?? ""} maxLength={80} /></Field>
                      </div>
                      {c.state === "confirmed" ? <Checkbox name="agreed" label={`${c.name} has agreed to the new times`} hint="Otherwise they'll be asked to reconfirm, and it won't count as cover until they do." /> : null}
                      <Field label="If there's a clash: why it's fine (optional)"><Input name="override_note" maxLength={500} /></Field>
                    </ActionForm>
                  </details>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ))}
      <p className="text-sm"><Link className="font-semibold text-club-blue underline" href="/calendar">See it on the calendar</Link></p>
    </section>
  );
}
