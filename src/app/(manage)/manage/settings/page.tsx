import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Field, Input, Notice, Textarea } from "@/components/ui";
import { requireLevel } from "@/lib/auth/dal";
import { HUB_ADMIN } from "@/lib/auth/access";
import { loadClubSettings, loadDutyTypes, loadEmailBacklog, loadEmailRelease, loadOutboxSummary, loadTeams, loadVenues, type EmailBacklogRow, type OutboxSummaryRow } from "@/lib/data/manage";
import { emailConfig } from "@/lib/email/worker";
import { formatDay, formatTime } from "@/lib/time/london";
import { retryFailedEmailsAction, saveClubSettingsAction, setEmailReleaseAction, saveDutyTypeAction, saveTeamAction, saveVenueAction } from "./actions";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({ searchParams }: PageProps<"/manage/settings">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: { searchParams: PageProps<"/manage/settings">["searchParams"] }) {
  await requireLevel(HUB_ADMIN);
  const [venues, teams, duties, settings, outbox, backlog, release] = await Promise.all([
    loadVenues(), loadTeams(), loadDutyTypes(), loadClubSettings(), loadOutboxSummary(), loadEmailBacklog(), loadEmailRelease(),
  ]);
  const sp = await searchParams;
  const num = (v: unknown) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : 0);
  const emailNote = sp.email === "paused" ? { kind: "paused" as const }
    : sp.email === "started" ? { kind: "started" as const, held: num(sp.held), dropped: num(sp.dropped) } : null;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold text-club">Settings</h1>

      <Card title="Rota rules">
        <ActionForm action={saveClubSettingsAction} submitLabel="Save" variant="secondary">
          <Field label="Withdrawal cut-off (hours before a duty)" hint="Inside this window volunteers can only request a cancellation; cover is kept until an organiser acts.">
            <Input type="number" name="withdrawal_cutoff_hours" min={0} max={336} defaultValue={settings?.withdrawal_cutoff_hours ?? 24} className="max-w-32" />
          </Field>
          <Checkbox name="reminder_day_before" defaultChecked={settings?.reminder_day_before ?? true} label="Send a reminder email the day before (UK time)" />
          <p className="text-xs text-ink-muted">Time zone: {settings?.timezone ?? "Europe/London"}</p>
        </ActionForm>
      </Card>

      <EmailCard rows={outbox} backlog={backlog} releasedFrom={release.releasedFrom} note={emailNote} />

      <Card title="Venues">
        <div className="space-y-3">
          {venues.map((v) => (
            <details key={v.id} className="rounded-lg border border-line p-2">
              <summary className="cursor-pointer font-semibold">{v.name}{v.active ? "" : " (inactive)"}</summary>
              <ActionForm action={saveVenueAction} submitLabel="Save venue" variant="secondary" className="mt-2 space-y-3">
                <input type="hidden" name="venue_id" value={v.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name"><Input name="name" defaultValue={v.name} required maxLength={80} /></Field>
                  <Field label="Short name"><Input name="short_name" defaultValue={v.short_name} required maxLength={30} /></Field>
                </div>
                <Field label="Address (optional)"><Textarea name="address" defaultValue={v.address ?? ""} maxLength={300} /></Field>
                <Checkbox name="active" defaultChecked={v.active} label="Active" />
              </ActionForm>
            </details>
          ))}
          <details className="rounded-lg border border-dashed border-line p-2">
            <summary className="cursor-pointer font-semibold text-club">Add a venue</summary>
            <ActionForm action={saveVenueAction} submitLabel="Add venue" className="mt-2 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input name="name" required maxLength={80} /></Field>
                <Field label="Short name"><Input name="short_name" required maxLength={30} /></Field>
              </div>
              <Field label="Address (optional)"><Textarea name="address" maxLength={300} /></Field>
            </ActionForm>
          </details>
        </div>
      </Card>

      <Card title="Teams">
        <ul className="space-y-2">
          {teams.map((t) => (
            <li key={t.id}>
              <ActionForm action={saveTeamAction} submitLabel="Save" variant="secondary" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="team_id" value={t.id} />
                <Field label="Team"><Input name="name" defaultValue={t.name} required maxLength={80} /></Field>
                <Checkbox name="active" defaultChecked={t.active} label="Active" />
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={saveTeamAction} submitLabel="Add team" className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="New team"><Input name="name" required maxLength={80} placeholder="e.g. Reserves" /></Field>
        </ActionForm>
      </Card>

      <Card title="Duties">
        <Notice tone="info">The club uses exactly these nine duties. You can rename them, change descriptions and decide which need a club authorisation. Authorisation is a club eligibility flag only. Never record DBS or safeguarding details here.</Notice>
        <div className="mt-3 space-y-2">
          {duties.map((d) => (
            <details key={d.id} className="rounded-lg border border-line p-2">
              <summary className="cursor-pointer font-semibold">{d.name}{d.requires_authorisation ? " · authorised only" : ""}{d.active ? "" : " · inactive"}</summary>
              <ActionForm action={saveDutyTypeAction} submitLabel="Save duty" variant="secondary" className="mt-2 space-y-3">
                <input type="hidden" name="duty_id" value={d.id} />
                <Field label="Name"><Input name="name" defaultValue={d.name} required maxLength={80} /></Field>
                <Field label="Description"><Textarea name="description" defaultValue={d.description ?? ""} maxLength={1000} /></Field>
                <Checkbox name="requires_authorisation" defaultChecked={d.requires_authorisation} label="Needs a club authorisation" />
                <Checkbox name="active" defaultChecked={d.active} label="Active" />
              </ActionForm>
            </details>
          ))}
        </div>
      </Card>
    </section>
  );
}

const STATUS_LABEL: Record<OutboxSummaryRow["status"], string> = {
  pending: "Queued", sending: "Sending", sent: "Sent", failed: "Failed", suppressed: "Not sent",
};

/** Readable names for message kinds (organiser-facing only). */
const KIND_LABEL: Record<string, string> = {
  signup_confirmed: "Sign-up confirmed", signup_pending: "Sign-up awaiting approval", invitation_accepted: "Invitation accepted",
  approval_confirmed: "Approved", approval_declined: "Not approved", duty_invitation: "Invitation to a duty",
  withdrawal_confirmed: "Withdrawal confirmed", assignment_removed: "Taken off a duty", cancellation_approved: "Late cancellation approved",
  cancellation_declined: "Late cancellation declined", event_cancelled: "Event cancelled", event_postponed: "Event postponed",
  reconfirm_needed: "Please reconfirm", shift_cancelled: "Duty cancelled", reminder: "Day-before reminder",
  cancellation_requested: "Organiser alert: cancellation request", venue_cover_at_risk: "Organiser alert: site cover at risk",
};

/**
 * Email has two switches and both must be on before anything is sent:
 *  1. the hosting switch (EMAIL_SENDING_ENABLED, plus pilot/production mode), set in Vercel;
 *  2. "Start email" here, which records when sending began (the database release switch).
 * Server-rendered from flags and counts only: no keys, addresses or message content reach the page.
 */
type EmailNote = { kind: "paused" } | { kind: "started"; held: number; dropped: number } | null;

function EmailCard({ rows, backlog, releasedFrom, note }: { rows: OutboxSummaryRow[]; backlog: EmailBacklogRow[]; releasedFrom: string | null; note: EmailNote }) {
  const cfg = emailConfig();
  const hostingOn = cfg.enabled && cfg.problems.length === 0;
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.status, (totals.get(r.status) ?? 0) + r.message_count);
  const failed = rows.filter((r) => r.status === "failed");
  const held = backlog.reduce((n, b) => n + b.held, 0);
  const current = backlog.reduce((n, b) => n + b.still_current, 0);
  const outOfDate = backlog.reduce((n, b) => n + b.out_of_date, 0);
  const people = Math.max(0, ...backlog.map((b) => b.recipients));
  const released = releasedFrom ? new Date(releasedFrom) : null;
  const hostingText = !cfg.enabled ? "Off"
    : cfg.problems.length ? "On, but not set up correctly (nothing can be sent)"
    : cfg.production ? "On: all volunteers"
    : `On in ${process.env.APP_ENV === "pilot" ? "pilot" : "test"} mode: only ${cfg.allowlist.size} approved address${cfg.allowlist.size === 1 ? "" : "es"}`;
  const overall = !hostingOn
    ? { tone: "info" as const, text: "No emails are being sent. Messages are kept in a queue and held back." }
    : !released
      ? { tone: "warn" as const, text: "The hosting switch is on, but email hasn't been started here, so nothing is sent yet. Review what is waiting below, then start." }
      : cfg.production
        ? { tone: "good" as const, text: "Email is on. Volunteers receive their emails." }
        : { tone: "warn" as const, text: "Email is on in pilot mode: only approved addresses receive email. Everyone else's messages are not sent." };

  return (
    <section id="email" className="scroll-mt-4"><Card title="Email">
      {note?.kind === "started" && released ? (
        <Notice tone="good" title="Email started.">
          {note.held ? `${note.held} older queued email${note.held === 1 ? " was" : "s were"} held back and won't be sent. ` : ""}
          {note.dropped ? `${note.dropped} out-of-date email${note.dropped === 1 ? " was" : "s were"} dropped. ` : ""}
          New messages are sent as they happen.
        </Notice>
      ) : null}
      {note?.kind === "paused" && !released ? <Notice tone="warn" title="Email paused.">Nothing will be sent until you start it again.</Notice> : null}
      <Notice tone={overall.tone}>{overall.text}</Notice>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">1. Hosting switch</dt><dd className="font-semibold">{hostingText}</dd>
        <dt className="text-ink-muted">2. Started here</dt>
        <dd className="font-semibold">{released ? (released.getFullYear() < 1900 ? "Yes" : `Yes, since ${formatDay(released)} ${formatTime(released)}`) : "No: held"}</dd>
      </dl>

      {released && !hostingOn ? (
        <Notice tone="warn" title="Email is still started here">
          The hosting switch is off, but email is still started in this app. Messages queued meanwhile would be sent (if still true) when the
          hosting switch goes back on. Pause here first if that isn&apos;t wanted.
        </Notice>
      ) : null}

      {!released ? (
        <div className="mt-4 space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-semibold text-club">Start email</h3>
          {held ? (
            <>
              <p className="text-sm">
                <strong>{held}</strong> queued {held === 1 ? "email is" : "emails are"} being held: <strong>{current}</strong> still true
                {current ? ` (to ${people === 1 && backlog.length === 1 ? "1 person" : `at least ${people} ${people === 1 ? "person" : "people"}`})` : ""}, <strong>{outOfDate}</strong> out of date. Out-of-date ones are never sent.
              </p>
              <table className="w-full text-sm">
                <caption className="sr-only">Held emails by type</caption>
                <thead><tr className="text-left text-xs text-ink-muted"><th scope="col">Type</th><th scope="col" className="text-right">Held</th><th scope="col" className="text-right">Still true</th><th scope="col" className="text-right">People</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {backlog.map((b) => (
                    <tr key={b.kind}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal">{KIND_LABEL[b.kind] ?? b.kind}</th>
                      <td className="py-1 text-right tabular-nums">{b.held}</td>
                      <td className="py-1 text-right tabular-nums">{b.still_current}</td>
                      <td className="py-1 text-right tabular-nums">{b.recipients}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="text-sm">Nothing is waiting in the queue.</p>}
          {hostingOn ? (
            <div className="flex flex-col gap-3">
              <ActionForm action={setEmailReleaseAction} submitLabel="Start: new emails only (recommended)" pendingLabel="Starting…"
                confirm={held ? `Start email? The ${held} held email(s) will never be sent; only messages from now on.` : "Start email? Messages from now on will be sent."}>
                <input type="hidden" name="mode" value="new_only" />
              </ActionForm>
              {current ? (
                <ActionForm action={setEmailReleaseAction} submitLabel={`Start, and also send the ${current} still-true held email${current === 1 ? "" : "s"}`} variant="secondary" pendingLabel="Starting…"
                  confirm={`Send the ${current} held email(s) that are still true, to at least ${people} ${people === 1 ? "person" : "people"}? Some may be days old.`}>
                  <input type="hidden" name="mode" value="include_current" />
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Starting is available once the hosting switch is on and set up. Turning that switch on does not send anything by itself.</p>
          )}
        </div>
      ) : (
        <ActionForm action={setEmailReleaseAction} submitLabel="Pause all emails" variant="danger" pendingLabel="Pausing…" className="mt-3"
          confirm="Pause all emails? Nothing will be sent until you start again.">
          <input type="hidden" name="mode" value="pause" />
        </ActionForm>
      )}

      <p className="mt-4 text-sm text-ink-muted">
        Every message is checked again just before it is sent: if the duty has changed since (accepted, withdrawn, cancelled, moved), or a
        request has been dealt with, it isn&apos;t sent. Demo events never send email. Each volunteer only ever receives details of their own duty.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3">No emails in the last 30 days.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          {(["pending", "sent", "failed", "suppressed"] as const).map((st) => (
            <div key={st}><dt className="text-sm text-ink-muted">{STATUS_LABEL[st]}</dt><dd className="text-lg font-bold">{totals.get(st) ?? 0}</dd></div>
          ))}
        </dl>
      )}
      <div className="mt-3 space-y-2">
        {failed.length > 0 ? (
          <p className="text-sm">Last error: <code className="rounded bg-surface-muted px-1">{failed[0].last_error ?? "unknown"}</code></p>
        ) : null}
        {/* Always shown, so its confirmation message survives the refresh that clears the failures. */}
        <ActionForm action={retryFailedEmailsAction} submitLabel="Retry failed emails" variant="secondary" />
        <p className="text-xs text-ink-muted">Retrying gives each failed email up to 5 more attempts, and each is checked again before it goes. A failed email never undoes a sign-up or change.</p>
      </div>
      <p className="mt-2 text-xs text-ink-muted">Figures cover the last 30 days. &ldquo;Not sent&rdquo; includes held, out-of-date, demo and pilot-mode messages.</p>
    </Card></section>
  );
}
