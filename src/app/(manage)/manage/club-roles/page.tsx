import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Notice } from "@/components/ui";
import { PositionFields } from "@/components/hub/position-fields";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadPositions, loadTeamStaff, loadTeams } from "@/lib/data/hub";
import { TeamManagementList } from "@/components/hub/role-lists";
import { loadPicker } from "@/lib/data/hub-involvement";
import { OCCUPANCY_LABEL, recruitingLabels } from "@/lib/domain/positions";
import { addSuggestedPositionsAction, savePositionAction } from "./actions";

export const metadata: Metadata = { title: "Club roles" };

export default function ClubRolesPage() {
  return <Suspense fallback={<PageLoading />}><ClubRoles /></Suspense>;
}

async function ClubRoles() {
  const me = await requireLevel(HUB_MANAGERS);
  const isAdmin = me.level === "admin";
  const [positions, people, teamStaff, teams] = await Promise.all([loadPositions(), isAdmin ? loadPicker() : Promise.resolve([]), loadTeamStaff(), isAdmin ? loadTeams() : Promise.resolve([])]);
  const clubRoles = positions.filter((p) => p.kind !== "team");
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Club roles</h1>
      <Notice tone="info">Who does what at the club, and where help or a successor is wanted. Filled roles can look for a successor without removing the current holder. Records here are not formal club or FA appointments.</Notice>
      {positions.length === 0 && isAdmin ? (
        <Card title="Get started">
          <p className="mb-2 text-sm">Add the usual roles (Club Secretary, Senior Secretary, Youth Secretary, Groundsman, Social Media, Finance, Vice-Chairman, Welfare Officer) as empty drafts. Nobody is assigned and nothing is advertised.</p>
          <ActionForm action={addSuggestedPositionsAction} submitLabel="Add the usual roles" variant="secondary" />
        </Card>
      ) : null}
      <h2 className="text-lg font-semibold text-club">Club roles (non-playing)</h2>
      {clubRoles.length === 0 ? <p className="rounded-xl border border-line bg-white p-3 text-sm text-ink-muted">No club roles recorded yet.</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {clubRoles.map((p) => (
          <li key={p.id} className={`rounded-xl border border-line bg-white p-3 ${p.active ? "" : "opacity-70"}`}>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin ? <Link href={`/manage/club-roles/${p.id}`} className="font-semibold text-club-blue underline">{p.title}</Link> : <span className="font-semibold">{p.title}</span>}
              <Badge tone={p.occupancy === "vacant" ? "warn" : "neutral"}>{OCCUPANCY_LABEL[p.occupancy]}</Badge>
              {recruitingLabels(p).map((l) => <Badge key={l} tone="info">{l}</Badge>)}
              {!p.active ? <Badge>Not in use</Badge> : null}
            </div>
            <p className="text-sm">{p.holders.length ? p.holders.map((h) => h.name + (h.capacity !== "holder" ? ` (${h.capacity})` : "")).join(", ") : "No current holder"}</p>
            <p className="text-xs text-ink-muted">{[p.department, p.public_reason ? "On the public page" : p.public_visible ? "Public when recruiting" : "Not public",
              p.interests?.length ? `${p.interests.length} interested` : null].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
      <h2 className="text-lg font-semibold text-club">Team management</h2>
      <p className="text-sm text-ink-muted">Staff come from each person&apos;s team roles (People). Add a team-management role here to record or advertise a post, e.g. a coach vacancy.</p>
      <TeamManagementList teams={teamStaff} positions={positions} linkRoles={isAdmin} />
      {isAdmin ? (
        <Card title="Add a role">
          <ActionForm action={savePositionAction} submitLabel="Add role"><PositionFields people={people} teams={teams} /></ActionForm>
        </Card>
      ) : null}
    </section>
  );
}
