import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { loadPositions, loadTeamStaff } from "@/lib/data/hub";
import { TeamManagementList } from "@/components/hub/role-lists";
import { LOCATION_LABEL, OCCUPANCY_LABEL, recruitingLabels, teamLine } from "@/lib/domain/positions";
import { registerInterestAction } from "../actions-roles";

export const metadata: Metadata = { title: "Opportunities" };

/** Club roles for members: where help or a successor is wanted first, then everyone's roles. */
export default function OpportunitiesPage() {
  return <Suspense fallback={<PageLoading />}><Opportunities /></Suspense>;
}

async function Opportunities() {
  await requirePerson();
  const [all, teamStaff] = await Promise.all([loadPositions(), loadTeamStaff()]);
  const positions = all.filter((p) => p.active);
  const clubRoles = positions.filter((p) => p.kind !== "team");
  const recruiting = positions.filter((p) => recruitingLabels(p).length > 0);
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Opportunities</h1>
      <h2 className="text-lg font-semibold text-club">Roles looking for help</h2>
      {recruiting.length === 0 ? <Card><p className="text-sm">No roles are asking for help right now.</p></Card> : recruiting.map((p) => (
        <Card key={p.id} title={p.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{p.kind === "team" ? `Team management${p.team ? ` · ${teamLine(p)}` : ""}` : "Club role"}</p>
          <div className="flex flex-wrap gap-1">{recruitingLabels(p).map((l) => <Badge key={l} tone="info">{l}</Badge>)}</div>
          {p.public_summary ? <p className="mt-2 text-sm">{p.public_summary}</p> : null}
          <p className="mt-1 text-xs text-ink-muted">{[p.estimated_commitment, p.work_location_preference ? LOCATION_LABEL[p.work_location_preference] : null,
            p.training_available ? "Training offered" : null, p.holders.length ? `Currently: ${p.holders.map((h) => h.name).join(", ")}` : null,
            p.recruiting_contact ? `Talk to ${p.recruiting_contact}` : null].filter(Boolean).join(" · ")}</p>
          {p.my_interest ? <p className="mt-2"><Badge tone="good">You&apos;ve said you&apos;re interested</Badge></p> : (
            <ActionForm action={registerInterestAction} submitLabel="I'm interested" className="mt-3" submitAriaLabel={`I'm interested in ${p.title}`}>
              <input type="hidden" name="position_id" value={p.id} />
            </ActionForm>
          )}
        </Card>
      ))}
      <h2 className="text-lg font-semibold text-club">Team management</h2>
      <TeamManagementList teams={teamStaff} positions={positions} />
      <h2 className="text-lg font-semibold text-club">Club roles (non-playing)</h2>
      {clubRoles.length === 0 ? <p className="rounded-xl border border-line bg-white p-3 text-sm text-ink-muted">No club roles recorded yet.</p> : null}
      {clubRoles.length ? <ul className="divide-y divide-line rounded-xl border border-line bg-white">
        {clubRoles.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="font-semibold">{p.title}</span>
            <span className="text-sm">{p.holders.length ? p.holders.map((h) => h.name).join(", ") : <Badge tone="warn">{OCCUPANCY_LABEL.vacant}</Badge>}</span>
          </li>
        ))}
      </ul> : null}
    </section>
  );
}
