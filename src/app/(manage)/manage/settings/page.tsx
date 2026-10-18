import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Field, Input, Notice, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth/dal";
import { loadClubSettings, loadDutyTypes, loadOutboxSummary, loadTeams, loadVenues, type OutboxSummaryRow } from "@/lib/data/manage";
import { emailConfig } from "@/lib/email/worker";
import { formatDay, formatTime } from "@/lib/time/london";
import { retryFailedEmailsAction, saveClubSettingsAction, saveDutyTypeAction, saveTeamAction, saveVenueAction } from "./actions";
import { SetupTabs } from "@/components/manage-nav";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Settings />
    </Suspense>
  );
}

async function Settings() {
  await requireRole(["admin"]);
  const [venues, teams, duties, settings, outbox] = await Promise.all([loadVenues(), loadTeams(), loadDutyTypes(), loadClubSettings(), loadOutboxSummary()]);

  return (
    <section className="space-y-4">
      <SetupTabs current="settings" isAdmin />
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

      <EmailCard rows={outbox} />

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
  pending: "Waiting to send", sending: "Sending", sent: "Sent", failed: "Failed", suppressed: "Not sent (by design)",
};

/** Server-rendered from configuration flags only: no keys or addresses ever reach the page. */
function EmailCard({ rows }: { rows: OutboxSummaryRow[] }) {
  const cfg = emailConfig();
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.status, (totals.get(r.status) ?? 0) + r.message_count);
  const failed = rows.filter((r) => r.status === "failed");
  const waiting = rows.filter((r) => r.status === "pending" && r.oldest_due).map((r) => new Date(r.oldest_due!)).sort((a, b) => +a - +b)[0];
  const mode = !cfg.enabled ? { tone: "info" as const, text: "Email sending is switched off. Messages are queued but nothing is sent. It is switched on in the hosting settings once the pilot is approved." }
    : cfg.problems.length ? { tone: "bad" as const, text: "Email sending is switched on but not fully set up, so nothing is being sent. Ask the person who manages the hosting to check the email settings." }
    : cfg.production ? { tone: "good" as const, text: "Email sending is on. Volunteers receive their emails." }
    : { tone: "warn" as const, text: `Email sending is on in ${process.env.APP_ENV === "pilot" ? "pilot" : "test"} mode: only ${cfg.allowlist.size} approved address${cfg.allowlist.size === 1 ? "" : "es"} receive email. Everything else is held back.` };
  return (
    <Card title="Email">
      <Notice tone={mode.tone}>{mode.text}</Notice>
      {(!cfg.enabled || cfg.problems.length > 0) && (totals.get("pending") ?? 0) > 0 ? (
        <Notice tone="warn" title="Queued emails are waiting">
          {totals.get("pending")} email{totals.get("pending") === 1 ? " is" : "s are"} queued from while sending was off. As things stand,
          switching sending on would send any of these about duties that haven&apos;t started yet, even if they are now out of date.
          Talk to whoever manages the hosting before switching it on.
        </Notice>
      ) : null}
      <p className="mt-2 text-sm text-ink-muted">Demo events never send email. Each volunteer only ever receives details of their own duty.</p>
      {rows.length === 0 ? (
        <p className="mt-3">No emails in the last 30 days.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {(["pending", "sent", "failed", "suppressed"] as const).map((s) => (
            <div key={s}><dt className="text-sm text-ink-muted">{STATUS_LABEL[s]}</dt><dd className="text-lg font-bold">{totals.get(s) ?? 0}</dd></div>
          ))}
        </dl>
      )}
      {waiting ? <p className="mt-2 text-sm">Oldest waiting email was due {formatDay(waiting)} at {formatTime(waiting)}.</p> : null}
      <div className="mt-3 space-y-2">
        {failed.length > 0 ? (
          <p className="text-sm">Last error: <code className="rounded bg-surface-muted px-1">{failed[0].last_error ?? "unknown"}</code></p>
        ) : null}
        {/* Always shown, so its confirmation message survives the refresh that clears the failures. */}
        <ActionForm action={retryFailedEmailsAction} submitLabel="Retry failed emails" variant="secondary" />
      </div>
      <p className="mt-2 text-xs text-ink-muted">Figures cover the last 30 days.</p>
    </Card>
  );
}
