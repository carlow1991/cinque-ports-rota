import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadDutyTypes, loadVenues, loadVolunteers, type AdminVolunteer, type DutyType, type Venue } from "@/lib/data/manage";
import { londonParts } from "@/lib/time/london";
import { authInvitesEnabled } from "@/lib/supabase/admin";
import { inviteVolunteerAction, setAccessAction, setAuthorisationAction, setVenuesAction } from "./actions";

export const metadata: Metadata = { title: "Volunteers" };

const ROLE_LABEL = { admin: "Administrator", coordinator: "Coordinator", volunteer: "Volunteer" } as const;

export default function VolunteersPage({ searchParams }: PageProps<"/manage/volunteers">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Volunteers searchParams={searchParams} />
    </Suspense>
  );
}

async function Volunteers({ searchParams }: { searchParams: PageProps<"/manage/volunteers">["searchParams"] }) {
  const me = await requireRole(MANAGER_ROLES);
  const sp = await searchParams;
  const isAdmin = me.role === "admin";
  const [people, venues, duties] = await Promise.all([loadVolunteers(), loadVenues(), loadDutyTypes()]);
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const show = sp.show === "suspended" ? "suspended" : sp.show === "all" ? "all" : "active";
  const list = people
    .filter((p) => (show === "all" ? true : show === "active" ? p.is_active : !p.is_active))
    .filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q));

  return (
    <section aria-labelledby="vol-heading" className="space-y-4">
      <h1 id="vol-heading" className="text-2xl font-bold text-club">Volunteers</h1>

      {!isAdmin ? (
        <Notice tone="info">You can see the contact details of volunteers who are on duties at your venues. Only administrators can add people or change access.</Notice>
      ) : (
        <Card title="Add a volunteer">
          {!authInvitesEnabled() ? (
            <p className="mb-2 text-sm text-ink-muted">Invitation emails are switched off until the pilot is approved. People added here are ready to invite with the invite script.</p>
          ) : null}
          <ActionForm action={inviteVolunteerAction} submitLabel="Add and invite" pendingLabel="Adding…">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><Input name="display_name" required maxLength={80} autoComplete="off" /></Field>
              <Field label="Email"><Input name="email" type="email" required maxLength={254} autoComplete="off" /></Field>
              <Field label="Access">
                <Select name="role" defaultValue="volunteer">
                  <option value="volunteer">Volunteer</option><option value="coordinator">Coordinator</option><option value="admin">Administrator</option>
                </Select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}

      <form action="/manage/volunteers" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="vq">Search</label>
        <input id="vq" name="q" defaultValue={q} placeholder="Search name or email" className="min-h-11 flex-1 rounded-lg border border-line bg-white px-3" />
        {isAdmin ? (
          <select name="show" defaultValue={show} aria-label="Show" className="min-h-11 rounded-lg border border-line bg-white px-2">
            <option value="active">Active</option><option value="suspended">Suspended</option><option value="all">Everyone</option>
          </select>
        ) : null}
        <button className="min-h-11 rounded-lg border border-line bg-white px-4 font-semibold text-club">Search</button>
      </form>

      <p className="text-sm text-ink-muted">{list.length} {list.length === 1 ? "person" : "people"}</p>
      <ul className="space-y-2">
        {list.map((p) => <Person key={p.id} p={p} isAdmin={isAdmin} isMe={p.id === me.id} venues={venues} duties={duties} />)}
      </ul>
    </section>
  );
}

function Person({ p, isAdmin, isMe, venues, duties }: { p: AdminVolunteer; isAdmin: boolean; isMe: boolean; venues: Venue[]; duties: DutyType[] }) {
  const restricted = duties.filter((d) => d.requires_authorisation);
  return (
    <li className="rounded-xl border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.display_name}</span>
        <Badge tone={p.role === "admin" ? "info" : "neutral"}>{ROLE_LABEL[p.role]}</Badge>
        {!p.is_active ? <Badge tone="bad">Suspended</Badge> : null}
        {p.linked_at ? null : <Badge tone="warn">Not signed in yet</Badge>}
        {isMe ? <Badge>You</Badge> : null}
      </div>
      <p className="break-all text-sm">{p.email}{p.phone ? <> · <a className="text-club-blue underline" href={`tel:${p.phone.replace(/[^+0-9]/g, "")}`}>{p.phone}</a></> : null}</p>
      {p.role === "coordinator" ? <p className="text-xs text-ink-muted">Venues: {p.venues.map((v) => venues.find((x) => x.id === v)?.name).filter(Boolean).join(", ") || "none yet"}</p> : null}
      {p.authorisations.some((a) => a.active) ? (
        <p className="text-xs text-ink-muted">Authorised for: {p.authorisations.filter((a) => a.active).map((a) => {
          const d = duties.find((x) => x.id === a.duty_type_id)?.name;
          return a.valid_until ? `${d} (until ${londonParts(new Date(a.valid_until)).dateKey})` : d;
        }).join(", ")}</p>
      ) : null}

      {isAdmin ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-semibold text-club">Manage access</summary>
          <div className="mt-2 space-y-4">
            <ActionForm action={setAccessAction} submitLabel="Save access" variant="secondary"
              confirm={isMe ? "You are changing your own access. Continue?" : undefined}>
              <input type="hidden" name="volunteer_id" value={p.id} />
              <Field label="Access level">
                <Select name="role" defaultValue={p.role}>
                  <option value="volunteer">Volunteer</option><option value="coordinator">Coordinator (chosen venues)</option><option value="admin">Administrator</option>
                </Select>
              </Field>
              <Checkbox name="is_active" defaultChecked={p.is_active} label="Active" hint="Untick to suspend: they lose access immediately. Their history is kept." />
            </ActionForm>

            {p.role === "coordinator" ? (
              <ActionForm action={setVenuesAction} submitLabel="Save venues" variant="secondary">
                <input type="hidden" name="volunteer_id" value={p.id} />
                <fieldset><legend className="text-sm font-semibold">Can manage events at</legend>
                  {venues.filter((v) => v.active).map((v) => <Checkbox key={v.id} name="venue_ids" value={v.id} defaultChecked={p.venues.includes(v.id)} label={v.name} />)}
                </fieldset>
              </ActionForm>
            ) : null}

            <div>
              <p className="text-sm font-semibold">Club authorisations</p>
              <p className="mb-2 text-xs text-ink-muted">Record only that the club has authorised them for this role and until when. Never record DBS or safeguarding details here.</p>
              <ul className="space-y-2">
                {restricted.map((d) => {
                  const a = p.authorisations.find((x) => x.duty_type_id === d.id);
                  return (
                    <li key={d.id}>
                      <ActionForm action={setAuthorisationAction} submitLabel="Save" variant="secondary" className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="volunteer_id" value={p.id} />
                        <input type="hidden" name="duty_code" value={d.code} />
                        <Checkbox name="active" defaultChecked={a?.active ?? false} label={d.name} />
                        <Field label="Valid until (optional)">
                          <Input type="date" name="valid_until" defaultValue={a?.valid_until ? londonParts(new Date(a.valid_until)).dateKey : ""} />
                        </Field>
                      </ActionForm>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </details>
      ) : null}
    </li>
  );
}
