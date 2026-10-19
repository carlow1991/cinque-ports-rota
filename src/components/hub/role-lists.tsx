import Link from "next/link";
import { Badge } from "@/components/ui";
import type { Position, TeamStaff } from "@/lib/data/hub";
import { OCCUPANCY_LABEL, recruitingLabels, teamLine } from "@/lib/domain/positions";

/**
 * The two kinds of role, shown separately:
 *  - Team management: each team (with league/division), its current staff from team roles, and any
 *    team-management posts recorded as club roles (e.g. an advertised coach vacancy).
 *  - Club roles: the non-playing roles that keep the club running.
 */
export function TeamManagementList({ teams, positions, linkRoles = false }: { teams: TeamStaff[]; positions: Position[]; linkRoles?: boolean }) {
  const byTeam = new Map<string | null, Position[]>();
  for (const p of positions.filter((x) => x.kind === "team")) byTeam.set(p.team_id, [...(byTeam.get(p.team_id) ?? []), p]);
  const general = byTeam.get(null) ?? [];
  if (!teams.length && !general.length) return <p className="rounded-xl border border-line bg-white p-3 text-sm text-ink-muted">No teams or team-management roles recorded yet.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {teams.map((t) => (
        <li key={t.team_id} className="rounded-xl border border-line bg-white p-3">
          <p className="font-semibold">{t.team}</p>
          {t.league || t.division ? <p className="text-xs text-ink-muted">{teamLine({ league: t.league, division: t.division })}</p> : null}
          <p className="mt-1 text-sm">{t.staff.length ? t.staff.map((s) => `${s.name} (${s.role})`).join(", ") : <span className="text-ink-muted">No staff recorded</span>}</p>
          <RoleRows roles={byTeam.get(t.team_id) ?? []} link={linkRoles} />
        </li>
      ))}
      {general.length ? (
        <li className="rounded-xl border border-line bg-white p-3">
          <p className="font-semibold">Across teams</p>
          <RoleRows roles={general} link={linkRoles} />
        </li>
      ) : null}
    </ul>
  );
}

function RoleRows({ roles, link }: { roles: Position[]; link: boolean }) {
  if (!roles.length) return null;
  return (
    <ul className="mt-2 space-y-1 border-t border-line pt-2">
      {roles.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
          {link ? <Link href={`/manage/club-roles/${p.id}`} className="font-semibold text-club-blue underline">{p.title}</Link> : <span className="font-semibold">{p.title}</span>}
          <span>{p.holders.length ? p.holders.map((h) => h.name).join(", ") : <Badge tone="warn">{OCCUPANCY_LABEL.vacant}</Badge>}</span>
          {recruitingLabels(p).map((l) => <Badge key={l} tone="info">{l}</Badge>)}
          {!p.active ? <Badge>Not in use</Badge> : null}
        </li>
      ))}
    </ul>
  );
}
