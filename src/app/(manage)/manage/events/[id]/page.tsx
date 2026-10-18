import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, CoverBadge, DemoBadge, EVENT_TYPE_LABEL, Field, Input, Notice, Select, StatusBadge, Textarea } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { SubTabs } from "@/components/manage-nav";
import { loadCoverageEvents, loadEvent, loadEventPeople, loadLinkedEvents, loadReschedulePreview, loadTeams, loadTemplates, loadVenues, type ReschedulePreviewRow, type RosterRow, type ShiftView } from "@/lib/data/manage";
import { ShiftPeople } from "./shift-people";
import { COVER_EXPLANATION, parseRanges } from "@/lib/domain/coverage";
import { describeOffset } from "@/lib/domain/templates";
import { capitalise, notifyFuture, notifyOutcome, type MessagingState } from "@/lib/email/state";
import { loadMessagingState } from "@/lib/email/state-server";
import { formatDay, formatLongDay, formatRange, formatTime, londonParts, londonWindow, zoneLabel } from "@/lib/time/london";
import {
  addShiftAction, applyTemplateAction, cancelEventAction, cancelShiftAction, completeEventAction, linkCoverAction,
  postponeAction, publishEventAction, rescheduleAction, setSiteCoverAction, updateDetailsAction, updateShiftAction,
} from "../actions";

export const metadata: Metadata = { title: "Event" };

export default function EventPage({ params, searchParams }: PageProps<"/manage/events/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EventDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventDetail({ params, searchParams }: { params: PageProps<"/manage/events/[id]">["params"]; searchParams: PageProps<"/manage/events/[id]">["searchParams"] }) {
  const me = await requireRole(MANAGER_ROLES);
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await loadEvent(id);
  if (!data) notFound();
  const { event: e, shifts, coverage, duties } = data;
  const isAdmin = me.role === "admin";

  const starts = new Date(e.starts_at);
  const ends = new Date(e.ends_at);
  const sp0 = londonParts(starts);
  const ep0 = londonParts(ends);
  const open = e.status === "draft" || e.status === "published" || e.status === "postponed";

  const [venues, teams, templates, coverOptions, linked, people] = await Promise.all([
    loadVenues(),
    loadTeams(),
    loadTemplates(),
    loadCoverageEvents(new Date(starts.getTime() - 24 * 3600_000), new Date(ends.getTime() + 24 * 3600_000)),
    e.event_type === "venue_coverage" ? loadLinkedEvents(e.id) : Promise.resolve([]),
    loadEventPeople(e.id),
  ]);
  const ended = new Date(e.ends_at).getTime() <= people.now;
  const mail = await loadMessagingState();
  // What happened to email at the time is not recorded per event, so say what is true now.
  const MAIL_NOTE = mail === "on" ? "They were emailed." : "Email may not have reached them (email is off or limited to approved addresses), so check they know.";
  const venue = venues.find((v) => v.id === e.venue_id);
  const team = teams.find((t) => t.id === e.team_id);
  const coverChoices = coverOptions.filter((c) => c.venue_id === e.venue_id && c.id !== e.id);
  const linkedCover = coverOptions.find((c) => c.id === e.coverage_event_id);
  const gaps = parseRanges(coverage?.gaps);
  const generated = new Set(shifts.map((s) => s.source_template_item_id).filter(Boolean) as string[]);
  const usableTemplates = templates.filter((t) => !t.venue_id || t.venue_id === e.venue_id);
  const totals = shifts.reduce((a, s) => ({ slots: a.slots + s.required_count, conf: a.conf + s.confirmed, pend: a.pend + s.pending, open: a.open + s.open }), { slots: 0, conf: 0, pend: 0, open: 0 });
  const dutyCodesOnEvent = new Set(shifts.map((x) => x.duty_code));
  const tab = sp.tab === "details" || sp.tab === "changes" ? sp.tab : "duties";
  const base = `/manage/events/${e.id}`;
  // Who a postponement or cancellation would affect: everyone invited, awaiting approval or confirmed.
  const ACTIVE = new Set(["invited", "pending_approval", "confirmed"]);
  const committed = people.rows.filter((r) => r.volunteer_id && r.status && ACTIVE.has(r.status));
  const affectedPeople = new Set(committed.map((r) => r.volunteer_id)).size;
  const affectedDuties = new Set(committed.map((r) => r.shift_id)).size;
  // Review step for a time change: ?tab=changes&review=1&date=…&start=…&end=…
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const proposal = tab === "changes" && sp.review === "1" ? londonWindow(str(sp.date), str(sp.start), str(sp.end)) : null;
  const preview = proposal?.ok ? await loadReschedulePreview(e.id, proposal.startsAt, proposal.endsAt) : null;

  return (
    <article className="space-y-4">
      {sp.created ? <Notice tone="good" title="Draft created">Check the duties below, then publish when ready.</Notice> : null}
      {sp.published && e.status === "published" ? <Notice tone="good" title="Published">Volunteers can now see this event and sign up for open duties.</Notice> : null}

      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={e.status} />
          <DemoBadge show={e.is_demo} />
          {open ? <CoverBadge state={coverage?.state} /> : null}
          <Badge>{EVENT_TYPE_LABEL[e.event_type] ?? e.event_type}</Badge>
        </div>
        <h1 className="text-2xl font-bold text-club">{e.title}</h1>
        <p className="text-ink">
          {venue?.name} · {formatLongDay(starts)} · <span className="text-ink-muted">Event</span> {formatRange(starts, ends)} {zoneLabel(starts)}
          {e.kickoff_at ? <> · <span className="text-ink-muted">Kick-off</span> {formatTime(new Date(e.kickoff_at))}</> : null}
        </p>
        {shifts.length ? (
          <p className="text-sm">
            <strong>Staffing:</strong> {totals.conf} of {totals.slots} places confirmed{totals.pend ? ` · ${totals.pend} awaiting approval` : ""}
            {totals.open ? <> · <strong className="text-danger">{totals.open} open</strong></> : " · all filled"}
          </p>
        ) : <p className="text-sm text-ink-muted">No duties yet.</p>}
        <p className="text-sm text-ink-muted">
          {[team?.name, e.opponent ? `v ${e.opponent}` : null, e.competition].filter(Boolean).join(" · ")}
        </p>
        {e.status === "cancelled" ? (
          <Notice tone="bad" title="Event cancelled">
            Reason: {e.status_reason ?? "none given"}. Everyone on a duty was taken off and their reminders stopped. {MAIL_NOTE}
          </Notice>
        ) : null}
        {e.status === "postponed" ? (
          <Notice tone="warn" title="Event postponed">
            Reason: {e.status_reason ?? "none given"}. Everyone who was on a duty needs to reconfirm. {MAIL_NOTE} Set the new date
            under &ldquo;Change date or times&rdquo;, then publish again. Volunteers confirm afresh once it&apos;s published.
          </Notice>
        ) : null}
      </header>

      <SubTabs label="Event sections" current={tab} tabs={[
        { key: "duties", href: base, label: "Duties" },
        ...(open ? [{ key: "details", href: `${base}?tab=details`, label: "Details" }, { key: "changes", href: `${base}?tab=changes`, label: "Changes" }] : []),
      ]} />

      {tab === "duties" ? (<>

      {open && (e.status === "draft" || e.status === "postponed") ? (
        <Card title="Publish">
          <p className="mb-2 text-sm">Publishing makes the event and its open duties visible to volunteers.</p>
          {coverage?.state === "no_cover" ? (
            <p className="mb-2 text-sm font-medium text-danger">Publishing is blocked until a site lead is added, venue cover is linked, or an admin records provider cover.</p>
          ) : null}
          <ActionForm action={publishEventAction} submitLabel="Publish event" pendingLabel="Publishing…">
            <input type="hidden" name="event_id" value={e.id} />
          </ActionForm>
        </Card>
      ) : null}

      {/* ---------------- Site cover ---------------- */}
      {open ? (
        <Card title="Site cover" actions={<CoverBadge state={coverage?.state} />}>
          <p className="text-sm">{COVER_EXPLANATION[coverage?.state ?? ""] ?? ""}</p>
          {coverage?.state === "covered_by_provider" ? (
            <p className="mt-2 text-sm"><Badge tone="info">External provider</Badge> No volunteer is named for provider cover.</p>
          ) : coverage?.state !== "not_required" && people.leads.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {people.leads.map((l, i) => (
                <li key={`${l.shift_id}-${i}`}>
                  <span className="font-mono tabular-nums">{formatRange(new Date(l.starts_at), new Date(l.ends_at))}</span>{" "}
                  {l.display_name ? (
                    <>
                      <strong>{l.display_name}</strong>{" "}
                      <Badge tone={l.status === "confirmed" && l.authorised && !l.cancellation_requested ? "good" : "warn"}>
                        {l.status === "confirmed"
                          ? (l.cancellation_requested ? "Asked to cancel, not counted as cover" : l.authorised ? "Site lead confirmed" : "Confirmed but authorisation lapsed")
                          : l.status === "pending_approval" ? "Awaiting approval" : "Invited, not confirmed"}
                      </Badge>
                    </>
                  ) : <Badge tone="bad">No site lead yet</Badge>}
                  {l.source === "linked_cover" ? <span className="text-ink-muted"> · via {l.event_title}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {gaps.length && coverage?.state !== "not_required" ? (
            <div className="mt-2">
              <p className="text-sm font-semibold">Times with no confirmed site lead:</p>
              <ul className="list-inside list-disc text-sm">
                {gaps.map((g) => <li key={g.start.toISOString()}>{formatRange(g.start, g.end)}</li>)}
              </ul>
            </div>
          ) : null}
          {e.site_cover_source !== "club_volunteer" ? (
            <p className="mt-2 text-sm"><Badge tone="info">{e.site_cover_source === "provider_verified" ? "Provider cover (admin-verified)" : "Not required (admin decision)"}</Badge> {e.external_cover_note}</p>
          ) : null}

          {e.event_type !== "venue_coverage" ? (
            <div className="mt-3 border-t border-line pt-3">
              <ActionForm action={linkCoverAction} submitLabel={e.coverage_event_id ? "Update link" : "Link"} variant="secondary">
                <input type="hidden" name="event_id" value={e.id} />
                <Field label="Venue-wide cover event" hint="Same venue only. Linking removes this event's own site-lead duty if nobody has taken it yet.">
                  <Select name="coverage_event_id" defaultValue={e.coverage_event_id ?? ""}>
                    <option value="">Not linked: this event provides its own site lead</option>
                    {coverChoices.map((c) => <option key={c.id} value={c.id}>{c.title} ({formatRange(new Date(c.starts_at), new Date(c.ends_at))})</option>)}
                  </Select>
                </Field>
                {linkedCover ? <p className="text-sm">Currently linked to <Link className="text-club-blue underline" href={`/manage/events/${linkedCover.id}`}>{linkedCover.title}</Link>.</p> : null}
              </ActionForm>
            </div>
          ) : (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm font-semibold">Events relying on this cover ({linked.length})</p>
              {linked.length ? (
                <ul className="mt-1 space-y-1 text-sm">
                  {linked.map((l) => <li key={l.id}><Link className="text-club-blue underline" href={`/manage/events/${l.id}`}>{l.title}</Link> · {formatRange(new Date(l.starts_at), new Date(l.ends_at))} · {l.status}</li>)}
                </ul>
              ) : <p className="text-sm text-ink-muted">None yet. Link fixtures to this cover from their own pages or when creating them.</p>}
            </div>
          )}

          {isAdmin ? (
            <details className="mt-3 border-t border-line pt-3">
              <summary className="cursor-pointer text-sm font-semibold text-club">Record an external-cover decision (admin)</summary>
              <ActionForm action={setSiteCoverAction} submitLabel="Save decision" variant="secondary" className="mt-2 space-y-3">
                <input type="hidden" name="event_id" value={e.id} />
                <Field label="Who covers site operations?">
                  <Select name="source" defaultValue={e.site_cover_source}>
                    <option value="club_volunteer">Club volunteer (site-lead duty or linked cover)</option>
                    <option value="provider_verified">External provider, verified</option>
                    <option value="not_required">Not required</option>
                  </Select>
                </Field>
                <Field label="Note: who confirmed it and how" hint="Required for provider / not required. Recorded with your name and the time.">
                  <Textarea name="note" defaultValue={e.external_cover_note ?? ""} maxLength={1000} />
                </Field>
              </ActionForm>
            </details>
          ) : null}
        </Card>
      ) : null}

      {/* ---------------- Duties ---------------- */}
      <Card title="Duties" actions={shifts.length ? <span className="text-sm">{totals.conf}/{totals.slots} confirmed{totals.pend ? ` · ${totals.pend} awaiting approval` : ""} · {totals.open} open</span> : null}>
        {shifts.length === 0 ? <p className="text-sm text-ink-muted">No duties yet. Add some below.</p> : null}
        <ul className="space-y-2">
          {shifts.map((s) => (
            <ShiftRow key={s.id} s={s} open={open} people={people.rows.filter((r) => r.shift_id === s.id)}
              started={new Date(s.starts_at).getTime() <= people.now} mail={mail} />
          ))}
        </ul>
      </Card>

      {e.status === "published" && ended ? (
        <Card title="After the event">
          <p className="mb-2 text-sm">Mark attendance on each duty above, then close the event.</p>
          <ActionForm action={completeEventAction} submitLabel="Mark event completed" variant="secondary">
            <input type="hidden" name="event_id" value={e.id} />
          </ActionForm>
        </Card>
      ) : null}

      {open ? (
        <details className="rounded-xl border border-line bg-white p-4" open={shifts.length === 0}>
          <summary className="cursor-pointer text-lg font-semibold text-club">Add duties</summary>
          <div className="mt-3 space-y-4">
<Card title="From a template">
            <div className="space-y-2">
              {usableTemplates.map((t) => {
                const remaining = t.items.filter((i) => !generated.has(i.id));
                return (
                  <details key={t.id} className="rounded-lg border border-line p-2">
                    <summary className="cursor-pointer text-sm font-semibold">{t.code}: {t.name}</summary>
                    <ActionForm action={applyTemplateAction} submitLabel="Add selected duties" variant="secondary" className="mt-2 space-y-2">
                      <input type="hidden" name="event_id" value={e.id} />
                      <input type="hidden" name="template_id" value={t.id} />
                      {remaining.length === 0 ? <p className="text-sm text-ink-muted">All duties from this template are already on the event.</p> : null}
                      {remaining.map((i) => (
                        <div key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                          <Checkbox name="enabled" value={i.id} defaultChecked={false} label={i.dutyName}
                            hint={`${describeOffset(i.startAnchor, i.startOffsetMinutes)} → ${describeOffset(i.endAnchor, i.endOffsetMinutes)}${i.suppressedByLinkedCover && e.coverage_event_id ? " · skipped while linked to venue cover" : ""}${dutyCodesOnEvent.has(i.dutyCode) ? ` · ⚠ this event already has a ${i.dutyName} duty; ticking adds another` : ""}`} />
                          <label className="text-sm">People <input type="number" name={`count_${i.id}`} min={1} max={50} defaultValue={i.requiredCount} className="w-16 rounded-lg border border-line px-2 py-1 text-center" /></label>
                        </div>
                      ))}
                    </ActionForm>
                  </details>
                );
              })}
            </div>
          </Card>
<Card title="By hand">
            <ActionForm action={addShiftAction} submitLabel="Add duty">
              <input type="hidden" name="event_id" value={e.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Duty">
                  <Select name="duty_code" defaultValue="general_support">
                    {duties.filter((d) => d.active).map((d) => <option key={d.code} value={d.code}>{d.name}{d.requires_authorisation ? " (authorised only)" : ""}</option>)}
                  </Select>
                </Field>
                <Field label="People needed"><Input type="number" name="required_count" min={1} max={50} defaultValue={1} /></Field>
                <Field label="Date"><Input type="date" name="date" defaultValue={sp0.dateKey} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="From"><Input type="time" name="start" defaultValue={sp0.time} /></Field>
                  <Field label="To" hint="Earlier than 'from' = next day"><Input type="time" name="end" defaultValue={ep0.time} /></Field>
                </div>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold">Also includes (same person, no extra places)</legend>
                <div className="grid sm:grid-cols-2">
                  {duties.filter((d) => d.active).map((d) => <Checkbox key={d.code} name="responsibilities" value={d.code} label={d.name} />)}
                </div>
              </fieldset>
              <Checkbox name="signup_enabled" defaultChecked label="Volunteers can sign up themselves" />
              <Checkbox name="approval_required" label="Sign-ups need organiser approval" />
              <Field label="Instructions (optional)"><Textarea name="instructions" maxLength={2000} /></Field>
            </ActionForm>
          </Card>
          </div>
        </details>
      ) : null}
      </>) : null}

      {tab === "changes" && open ? (<>
      {!ended ? (
        <Card title="Change date or times">
          {typeof sp.saved === "string" && /^\d+$/.test(sp.saved) ? (
            <div className="space-y-2">
              <Notice tone="good" title="New times saved">
                The event now runs {formatLongDay(starts)}, {formatRange(starts, ends)} {zoneLabel(starts)}.{" "}
                {Number(sp.saved)
                  ? <>{sp.saved} duty {Number(sp.saved) === 1 ? "place needs" : "places need"} reconfirming; the people concerned are listed under Events → Requests. {notifyOutcome(mail, "them", true)}</>
                  : "Nobody needed to reconfirm."}
              </Notice>
              <p className="flex flex-wrap gap-4 text-sm">
                <Link href={base} className="text-club-blue underline">Back to duties</Link>
                <Link href={`${base}?tab=changes`} className="text-club-blue underline">Make another change</Link>
              </p>
            </div>
          ) : proposal?.ok && proposal.startsAt.getTime() === starts.getTime() && proposal.endsAt.getTime() === ends.getTime() ? (
            <p className="text-sm">Those are the current times, so there is nothing to change. <Link href={`${base}?tab=changes`} className="text-club-blue underline">Try again</Link></p>
          ) : preview && proposal?.ok ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Check this before saving</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-muted">Now</dt><dd>{formatLongDay(starts)}, {formatRange(starts, ends)} {zoneLabel(starts)}</dd>
                <dt className="text-ink-muted">New</dt><dd className="font-semibold">{formatLongDay(proposal.startsAt)}, {formatRange(proposal.startsAt, proposal.endsAt)} {zoneLabel(proposal.startsAt)}</dd>
              </dl>
              <ReviewTable rows={preview} />
              <p className="text-sm">
                {reconfirmTotal(preview)
                  ? <><strong>{affectedPeople} {affectedPeople === 1 ? "person" : "people"}</strong> ({reconfirmTotal(preview)} duty {reconfirmTotal(preview) === 1 ? "place" : "places"}) will need to reconfirm, and won&apos;t count as cover until they do. {capitalise(notifyFuture(mail, "they"))}.</>
                  : "Nobody is on these duties yet, so nobody needs to reconfirm."}
              </p>
              {preview.some((r) => r.from_template) ? (
                <p className="text-xs text-ink-muted">Duties from a template are re-timed from the template&apos;s <strong>current</strong> settings. Other duties move by the same amount as the start.</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <ActionForm action={rescheduleAction} submitLabel="Confirm new times" pendingLabel="Saving…" className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="event_id" value={e.id} />
                  <input type="hidden" name="date" value={str(sp.date)} /><input type="hidden" name="start" value={str(sp.start)} /><input type="hidden" name="end" value={str(sp.end)} />
                </ActionForm>
                <Link href={`${base}?tab=changes`} className="text-sm text-club-blue underline">Change again</Link>
              </div>
            </div>
          ) : (
            <form action={base} className="space-y-3">
              <input type="hidden" name="tab" value="changes" /><input type="hidden" name="review" value="1" />
              <p className="text-sm">Moving an event moves its duties too. You&apos;ll see exactly what changes, and who has to reconfirm, before anything is saved.</p>
              {proposal && !proposal.ok ? <p role="alert" className="text-sm font-medium text-danger">{proposal.error}</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Date"><Input type="date" name="date" defaultValue={str(sp.date) || sp0.dateKey} required /></Field>
                <Field label="Event start"><Input type="time" name="start" defaultValue={str(sp.start) || sp0.time} required /></Field>
                <Field label="Event end" hint="Earlier than start = next day"><Input type="time" name="end" defaultValue={str(sp.end) || ep0.time} required /></Field>
              </div>
              <button className="min-h-11 rounded-lg border border-club bg-white px-4 font-semibold text-club">Review the change</button>
            </form>
          )}
        </Card>
      ) : <Card><p className="text-sm text-ink-muted">This event has finished, so it can&apos;t be moved, postponed or cancelled.</p></Card>}
      {open && !ended ? (
        <Card title="Postpone or cancel">
          <p className="mb-3 text-sm">
            {affectedPeople
              ? <>This affects <strong>{affectedPeople} {affectedPeople === 1 ? "person" : "people"}</strong> on {affectedDuties} {affectedDuties === 1 ? "duty" : "duties"}. </>
              : "Nobody is on a duty yet, so nobody else is affected. "}
            {affectedPeople ? capitalise(notifyFuture(mail, "they")) + "." : null}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {e.status === "published" ? (
              <ActionForm action={postponeAction} submitLabel="Postpone event" variant="secondary"
                confirm={`Postpone? Everyone on a duty must reconfirm once you publish the new date; ${notifyFuture(mail, "they")}.`}>
                <input type="hidden" name="event_id" value={e.id} />
                <Field label="Reason for postponing (volunteers will see it)"><Input name="reason" required maxLength={500} /></Field>
              </ActionForm>
            ) : null}
            <ActionForm action={cancelEventAction} submitLabel="Cancel event" variant="danger"
              confirm={`Cancel this event? All duties are cancelled and reminders stop; ${notifyFuture(mail, "volunteers")}. This can't be undone.`}>
              <input type="hidden" name="event_id" value={e.id} />
              <Field label="Reason for cancelling (volunteers will see it)"><Input name="reason" required maxLength={500} /></Field>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      </>) : null}

      {tab === "details" && open ? (
          <Card title="Edit details">
            <ActionForm action={updateDetailsAction} submitLabel="Save details" variant="secondary" trackChanges>
              <input type="hidden" name="event_id" value={e.id} />
              <input type="hidden" name="kickoff_date" value={sp0.dateKey} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title"><Input name="title" defaultValue={e.title} required maxLength={120} /></Field>
                <Field label="Team">
                  <Select name="team_id" defaultValue={e.team_id ?? ""}>
                    <option value="">None</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="Opponent"><Input name="opponent" defaultValue={e.opponent ?? ""} maxLength={120} /></Field>
                <Field label="Competition"><Input name="competition" defaultValue={e.competition ?? ""} maxLength={120} /></Field>
                <Field label="Kick-off time (same day)" hint="For information only. Duties are timed from the event start and end, so changing kick-off moves nothing."><Input type="time" name="kickoff" defaultValue={e.kickoff_at ? londonParts(new Date(e.kickoff_at)).time : ""} /></Field>
              </div>
              <Checkbox name="site_responsibility" defaultChecked={e.site_responsibility} label="The club is responsible for opening, running and locking the site" />
              <Field label="Description"><Textarea name="description" defaultValue={e.description ?? ""} maxLength={4000} /></Field>
              <Field label="Instructions for volunteers"><Textarea name="instructions" defaultValue={e.instructions ?? ""} maxLength={4000} /></Field>
            </ActionForm>
          </Card>
      ) : null}
    </article>
  );
}

function ShiftRow({ s, open, people, started, mail }: { s: ShiftView; open: boolean; people: RosterRow[]; started: boolean; mail: MessagingState }) {
  const st = new Date(s.starts_at);
  const en = new Date(s.ends_at);
  const p0 = londonParts(st);
  const p1 = londonParts(en);
  const onDuty = people.filter((r) => r.status === "invited" || r.status === "pending_approval" || r.status === "confirmed").length;
  return (
    <li id={`shift-${s.id}`} className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold">{s.duty_name}</p>
          {s.responsibilities.length ? <p className="text-xs text-ink-muted">Includes: {s.responsibilities.map((r) => r.name).join(", ")}</p> : null}
        </div>
        <p className="font-mono text-sm tabular-nums">{formatRange(st, en)}</p>
      </div>
      <p className="mt-1 text-sm">
        <strong>{s.confirmed}</strong>/{s.required_count} confirmed
        {s.pending ? ` · ${s.pending} awaiting approval` : ""}
        {s.invited ? ` · ${s.invited} invited (not counted)` : ""}
        {s.open ? <> · <strong className="text-danger">{s.open} open</strong></> : " · full"}
        {!s.signup_enabled ? " · organiser allocates" : ""}
        {s.approval_required ? " · approval needed" : ""}
      </p>
      {s.instructions ? <p className="mt-1 text-sm text-ink-muted">{s.instructions}</p> : null}
      <ShiftPeople shiftId={s.id} rows={people} started={started} open={open} />
      {open && !started ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-club">Edit or remove</summary>
          <ActionForm action={updateShiftAction} submitLabel="Save duty" variant="secondary" className="mt-2 space-y-3" trackChanges
            confirm="Save? If you change the times, anyone on this duty will be asked to reconfirm.">
            <input type="hidden" name="shift_id" value={s.id} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Field label="Date"><Input type="date" name="date" defaultValue={p0.dateKey} /></Field>
              <Field label="From"><Input type="time" name="start" defaultValue={p0.time} /></Field>
              <Field label="To" hint={p1.dateKey !== p0.dateKey ? "Next day" : undefined}><Input type="time" name="end" defaultValue={p1.time} /></Field>
              <Field label="People"><Input type="number" name="required_count" min={1} max={50} defaultValue={s.required_count} /></Field>
            </div>
            <Checkbox name="signup_enabled" defaultChecked={s.signup_enabled} label="Volunteers can sign up themselves" />
            <Checkbox name="approval_required" defaultChecked={s.approval_required} label="Sign-ups need organiser approval" />
            <Field label="Instructions"><Textarea name="instructions" defaultValue={s.instructions ?? ""} maxLength={2000} /></Field>
          </ActionForm>
          <ActionForm action={cancelShiftAction} submitLabel="Remove this duty" variant="danger" className="mt-3 space-y-2"
            confirm={`Remove this duty? ${capitalise(notifyFuture(mail, "anyone on it"))}.`}>
            <input type="hidden" name="shift_id" value={s.id} />
            <p className="text-sm">
              {onDuty ? <>{onDuty} {onDuty === 1 ? "person is" : "people are"} on this duty and will be taken off. {capitalise(notifyFuture(mail, "they"))}.</> : "Nobody is on this duty yet."}
            </p>
            <Field label="Reason (anyone on the duty will see it)"><Input name="reason" required maxLength={500} /></Field>
          </ActionForm>
        </details>
      ) : null}
    </li>
  );
}

const reconfirmTotal = (rows: ReschedulePreviewRow[]) => rows.reduce((n, r) => n + r.people_to_reconfirm, 0);

/** Old → new time for each duty, as the database will save it. */
function ReviewTable({ rows }: { rows: ReschedulePreviewRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">No duties on this event yet.</p>;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Each duty&apos;s current and new times</caption>
      <thead><tr className="text-left text-xs text-ink-muted"><th scope="col">Duty</th><th scope="col">Now</th><th scope="col">New</th></tr></thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => {
          const os = new Date(r.old_starts_at), oe = new Date(r.old_ends_at), ns = new Date(r.new_starts_at), ne = new Date(r.new_ends_at);
          const sameDay = londonParts(os).dateKey === londonParts(ns).dateKey;
          return (
            <tr key={r.shift_id}>
              <th scope="row" className="py-1 pr-2 text-left font-normal">{r.duty_name}{r.people_to_reconfirm ? <span className="block text-xs text-amber-800">{r.people_to_reconfirm} to reconfirm</span> : null}</th>
              <td className="py-1 pr-2 font-mono tabular-nums">{formatRange(os, oe)}</td>
              <td className="py-1 font-mono font-semibold tabular-nums">{sameDay ? "" : `${formatDay(ns)} `}{formatRange(ns, ne)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
