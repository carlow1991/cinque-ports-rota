import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Field, Input, LinkButton, Select } from "@/components/ui";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadDirectory, loadTeams, portalStatusLabel } from "@/lib/data/hub";
import { INVOLVEMENT, formatPhone, labelFor } from "@/lib/domain/hub-tags";

export const metadata: Metadata = { title: "People" };

export default function ManagePeoplePage(props: PageProps<"/manage/people">) {
  return <Suspense fallback={<PageLoading />}><ManagePeople {...props} /></Suspense>;
}

async function ManagePeople({ searchParams }: PageProps<"/manage/people">) {
  const me = await requireLevel(HUB_MANAGERS);
  const isAdmin = me.level === "admin";
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const team = typeof sp.team === "string" ? sp.team : "";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const portal = typeof sp.portal === "string" ? sp.portal : "";
  const [people, teams] = await Promise.all([loadDirectory(), loadTeams()]);
  const list = people.filter((p) =>
    (!q || p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q) || p.teams.some((t) => t.team.toLowerCase().includes(q) || t.role.toLowerCase().includes(q))) &&
    (!team || p.teams.some((t) => t.team === team)) &&
    (!kind || p.involvement.includes(kind)) &&
    (!portal || (portal === "invited" ? p.portal_status !== "not_invited" : p.portal_status === "not_invited")));

  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">People</h1>
        {isAdmin ? <LinkButton href="/manage/people/new">+ Person</LinkButton> : null}
      </div>
      <form className="grid gap-3 rounded-xl border border-line bg-white p-3 sm:grid-cols-4" role="search">
        <Field label="Search"><Input name="q" defaultValue={q} placeholder="Name, team or role" /></Field>
        <Field label="Team">
          <Select name="team" defaultValue={team}><option value="">All</option>{teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</Select>
        </Field>
        <Field label="Involvement">
          <Select name="kind" defaultValue={kind}><option value="">All</option>{INVOLVEMENT.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}</Select>
        </Field>
        {isAdmin ? (
          <Field label="Portal">
            <Select name="portal" defaultValue={portal}><option value="">All</option><option value="not_invited">Not invited</option><option value="invited">Invited or active</option></Select>
          </Field>
        ) : null}
        <div className="sm:col-span-4"><button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Filter</button></div>
      </form>
      <p className="text-sm text-ink-muted" role="status">{list.length} {list.length === 1 ? "person" : "people"}</p>
      {list.length === 0 ? <Card><p>No one matches. {isAdmin ? <Link className="text-club-blue underline" href="/manage/people/new">Add a person</Link> : null}</p></Card> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((p) => {
            const st = portalStatusLabel(p.portal_status);
            return (
              <li key={p.person_id} className="rounded-xl border border-line bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin ? <Link href={`/manage/people/${p.person_id}`} className="font-semibold text-club-blue underline">{p.name}</Link> : <span className="font-semibold">{p.name}</span>}
                  {isAdmin ? <Badge tone={st.tone}>{st.label}</Badge> : null}
                  {p.lifecycle_status === "inactive" ? <Badge>Inactive</Badge> : null}
                  {p.is_under_18 ? <Badge tone="warn">Under 18</Badge> : null}
                </div>
                <p className="text-sm text-ink-muted">{p.involvement.map((i) => labelFor(INVOLVEMENT, i)).join(" · ") || "—"}</p>
                {p.teams.length ? <p className="text-sm">{p.teams.map((t) => `${t.role}, ${t.team}`).join(" · ")}</p> : null}
                <p className="text-sm break-all">{[p.email, formatPhone(p.phone)].filter(Boolean).join(" · ")}</p>
                {isAdmin && p.routine_requests_enabled ? <p className="text-xs text-ink-muted">Suggested for availability requests</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
