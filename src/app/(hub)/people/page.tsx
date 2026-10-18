import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Card, Field, Input } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";
import { loadDirectory } from "@/lib/data/hub";
import { INVOLVEMENT, formatPhone, labelFor } from "@/lib/domain/hub-tags";

export const metadata: Metadata = { title: "People" };

/** Club directory for members: names, teams and roles; contact details only where shared. */
export default function PeoplePage(props: PageProps<"/people">) {
  return <Suspense fallback={<PageLoading />}><People {...props} /></Suspense>;
}

async function People({ searchParams }: PageProps<"/people">) {
  await requirePerson();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase().slice(0, 80) : "";
  const people = await loadDirectory();
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.teams.some((t) => `${t.team} ${t.role}`.toLowerCase().includes(q)));
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">People</h1>
      <form role="search" className="flex items-end gap-2">
        <div className="flex-1"><Field label="Search by name, team or role"><Input name="q" defaultValue={q} /></Field></div>
        <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Search</button>
      </form>
      {list.length === 0 ? <Card><p>No one matches that search.</p></Card> : (
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.person_id} className="rounded-xl border border-line bg-white p-3">
              <p className="font-semibold">{p.name}</p>
              {p.teams.length ? <p className="text-sm">{p.teams.map((t) => `${t.role}, ${t.team}`).join(" · ")}</p>
                : <p className="text-sm text-ink-muted">{p.involvement.map((i) => labelFor(INVOLVEMENT, i)).join(" · ")}</p>}
              {p.email || p.phone ? (
                <p className="text-sm">
                  {p.email ? <a className="break-all text-club-blue underline" href={`mailto:${p.email}`}>{p.email}</a> : null}
                  {p.email && p.phone ? " · " : null}
                  {p.phone ? <a className="text-club-blue underline" href={`tel:${p.phone}`}>{formatPhone(p.phone)}</a> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">Contact details appear only when someone has chosen to share them, or for organisers.</p>
    </section>
  );
}
