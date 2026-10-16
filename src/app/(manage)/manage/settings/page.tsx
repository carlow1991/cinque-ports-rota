import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Field, Input, Notice, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth/dal";
import { loadClubSettings, loadDutyTypes, loadTeams, loadVenues } from "@/lib/data/manage";
import { saveClubSettingsAction, saveDutyTypeAction, saveTeamAction, saveVenueAction } from "./actions";

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
  const [venues, teams, duties, settings] = await Promise.all([loadVenues(), loadTeams(), loadDutyTypes(), loadClubSettings()]);

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
