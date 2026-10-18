import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { PersonCoreFields, PersonMoreFields, PreferencesFields } from "@/components/hub/person-fields";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadPerson, loadTeams, loadVenues, portalStatusLabel } from "@/lib/data/hub";
import { authInvitesEnabled } from "@/lib/supabase/admin";
import { formatLongDay } from "@/lib/time/london";
import { sendInviteAction, setAccessAction, setPreferencesAction, setTeamRoleAction, updatePersonAction } from "../actions";

export const metadata: Metadata = { title: "Person" };

export default function PersonPage(props: PageProps<"/manage/people/[id]">) {
  return <Suspense fallback={<PageLoading />}><Person {...props} /></Suspense>;
}

const DONE: Record<string, [string, "good" | "warn"]> = {
  saved: ["Saved. Nothing was sent.", "good"],
  invited: ["Saved, and the portal invitation was sent.", "good"],
  invite_failed: ["Saved, but the invitation was not sent. See Portal access below.", "warn"],
};

async function Person({ params, searchParams }: PageProps<"/manage/people/[id]">) {
  const me = await requireLevel(HUB_ADMIN);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const [{ person: p, account, teams: roles, prefs, slots, scopes }, teams, venues] = await Promise.all([loadPerson(id), loadTeams(), loadVenues()]);
  if (!p) notFound();
  const done = typeof sp.done === "string" ? DONE[sp.done] : undefined;
  const status = portalStatusLabel(
    !account ? null : !account.enabled ? "disabled" : account.auth_user_id ? "active" : account.invite_state === "failed" ? "invite_failed" : account.invite_state === "sent" ? "invited" : "invite_not_sent");

  return (
    <section aria-labelledby="h" className="mx-auto max-w-3xl space-y-4">
      <p><Link href="/manage/people" className="text-sm font-semibold text-club-blue underline">← People</Link></p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">{p.display_name ?? p.full_name}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        {p.lifecycle_status !== "active" ? <Badge>{p.lifecycle_status === "inactive" ? "Inactive" : "Applicant"}</Badge> : null}
        {p.is_under_18 ? <Badge tone="warn">Under 18</Badge> : null}
      </div>
      {done ? <Notice tone={done[1]}>{done[0]}</Notice> : null}

      <Card title="Contact">
        <ActionForm action={updatePersonAction} submitLabel="Save" trackChanges>
          <input type="hidden" name="person_id" value={p.id} />
          <PersonCoreFields p={p} />
          <Checkbox name="routine_requests_enabled" label="Include in suggested availability recipients"
            hint="Pre-ticks them when you ask for availability. Nothing is sent until you press Send." defaultChecked={p.routine_requests_enabled} />
          <PersonMoreFields p={p} />
          <Field label="Status">
            <Select name="lifecycle_status" defaultValue={p.lifecycle_status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive (kept for history; can&apos;t sign in)</option>
              {p.lifecycle_status === "applicant" ? <option value="applicant">Applicant</option> : null}
            </Select>
          </Field>
        </ActionForm>
      </Card>

      <Card title="Teams">
        {roles.length === 0 ? <p className="text-sm text-ink-muted">Not linked to any team.</p> : (
          <ul className="space-y-3">
            {roles.map((r) => (
              <li key={r.id} className="rounded-lg border border-line p-3">
                <ActionForm action={setTeamRoleAction} submitLabel="Save role" variant="secondary">
                  <input type="hidden" name="person_id" value={p.id} />
                  <input type="hidden" name="team_role_id" value={r.id} />
                  <input type="hidden" name="team_id" value={r.team_id} />
                  <p className="font-semibold">{r.teams?.name}{r.active_to ? <> <Badge>Ended</Badge></> : null}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Role"><Input name="role_label" defaultValue={r.role_label} maxLength={60} required /></Field>
                    <Field label="From"><Input name="active_from" type="date" defaultValue={r.active_from} /></Field>
                    <Field label="Until (blank = current)"><Input name="active_to" type="date" defaultValue={r.active_to ?? ""} /></Field>
                  </div>
                  <Checkbox name="is_expected_by_default" defaultChecked={r.is_expected_by_default}
                    label="Expected at this team's events" hint="Shown as “Expected by role” — not confirmed, and never asked for availability automatically." />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        {teams.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No teams yet. Add the club&apos;s teams in <Link className="text-club-blue underline" href="/manage/settings">Settings</Link>.</p>
        ) : (
          <details className="mt-3 rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Add a team role</summary>
            <ActionForm action={setTeamRoleAction} submitLabel="Add role">
              <input type="hidden" name="person_id" value={p.id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Team">
                  <Select name="team_id" required defaultValue="">
                    <option value="" disabled>Choose a team</option>
                    {teams.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="Role"><Input name="role_label" placeholder="Manager, Coach…" maxLength={60} required /></Field>
              </div>
              <Checkbox name="is_expected_by_default" label="Expected at this team's events" hint="Shown as “Expected by role”, never as confirmed." />
            </ActionForm>
          </details>
        )}
      </Card>

      <Card title="Interests and usual availability">
        <ActionForm action={setPreferencesAction} submitLabel="Save" variant="secondary" trackChanges>
          <input type="hidden" name="person_id" value={p.id} />
          <PreferencesFields prefs={prefs} slots={slots} />
        </ActionForm>
      </Card>

      <Card title="Portal access">
        {!account ? (
          <p className="text-sm">Not invited. They&apos;re in the directory and can be asked to help offline; organisers can record their replies.</p>
        ) : (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-muted">Status</dt><dd className="font-semibold">{status.label}</dd></div>
            {account.last_invite_at ? <div><dt className="text-ink-muted">Last invitation</dt><dd>{formatLongDay(new Date(account.last_invite_at))}</dd></div> : null}
            {account.invite_state === "failed" || account.invite_state === "not_sent" ? (
              <div className="sm:col-span-2"><dt className="text-ink-muted">Why not sent</dt><dd>{account.last_invite_error ?? "Not sent yet"}</dd></div>
            ) : null}
          </dl>
        )}
        {!account?.auth_user_id ? (
          <div className="mt-3">
            {!p.email_normalized ? <p className="text-sm text-ink-muted">Add an email address above to invite them.</p> : p.is_under_18 ? null : (
              <ActionForm action={sendInviteAction} submitLabel={account ? "Send invitation again" : "Send portal invitation"} pendingLabel="Sending…"
                confirm={`Email a portal invitation to ${p.email_normalized}?`}>
                <input type="hidden" name="person_id" value={p.id} />
                <Field label="Access level">
                  <Select name="access_level" defaultValue={account?.access_level ?? "member"}>
                    <option value="member">Member</option><option value="coordinator">Coordinator</option><option value="admin">Administrator</option>
                  </Select>
                </Field>
                {!authInvitesEnabled() ? <p className="text-xs text-ink-muted">Invitation emails are switched off on this site; the result will show as not sent.</p> : null}
              </ActionForm>
            )}
          </div>
        ) : null}
        {account ? (
          <details className="mt-3 rounded-lg border border-line p-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Change access</summary>
            <ActionForm action={setAccessAction} submitLabel="Save access" variant="secondary"
              confirm={p.id === me.id ? "You are changing your own access. Continue?" : undefined}>
              <input type="hidden" name="person_id" value={p.id} />
              <Field label="Access level">
                <Select name="access_level" defaultValue={account.access_level}>
                  <option value="member">Member</option><option value="coordinator">Coordinator</option><option value="admin">Administrator</option>
                </Select>
              </Field>
              <Checkbox name="enabled" label="Can sign in" defaultChecked={account.enabled} />
              <fieldset>
                <legend className="text-sm font-semibold">Coordinator scope</legend>
                <p className="text-xs text-ink-muted">Coordinators manage events at these venues or for these teams.</p>
                <div className="grid gap-x-4 sm:grid-cols-2">
                  {venues.map((v) => <Checkbox key={v.id} name="venue_ids" value={v.id} label={`${v.name}${v.active ? "" : " (inactive)"}`} defaultChecked={scopes.some((s) => s.venue_id === v.id)} />)}
                  {teams.map((t) => <Checkbox key={t.id} name="team_ids" value={t.id} label={t.name} defaultChecked={scopes.some((s) => s.team_id === t.id)} />)}
                </div>
              </fieldset>
            </ActionForm>
          </details>
        ) : null}
      </Card>
    </section>
  );
}
