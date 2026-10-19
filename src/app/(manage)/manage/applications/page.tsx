import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Field, Input, Notice, Select } from "@/components/ui";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { STAGES, loadApplications } from "@/lib/data/hub-applications";
import { interestLabel } from "@/lib/domain/hub-tags";
import { formatDay, todayKey } from "@/lib/time/london";

export const metadata: Metadata = { title: "Applications" };

/** Volunteer applications from the public form (admins only). */
export default function ApplicationsPage(props: PageProps<"/manage/applications">) {
  return <Suspense fallback={<PageLoading />}><Applications {...props} /></Suspense>;
}

async function Applications({ searchParams }: PageProps<"/manage/applications">) {
  await requireLevel(HUB_ADMIN);
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const stage = STAGES.some((x) => x.code === s("stage")) ? s("stage") : "open";
  const q = s("q").toLowerCase().slice(0, 80);
  const all = await loadApplications();
  const today = todayKey();
  const list = all
    .filter((a) => (stage === "open" ? !["closed", "accepted_to_pool"].includes(a.stage) : a.stage === stage))
    .filter((a) => !q || a.full_name.toLowerCase().includes(q) || (a.email_normalized ?? "").includes(q))
    .sort((a, b) => (s("sort") === "oldest" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
  const count = (c: string) => all.filter((a) => a.stage === c).length;
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Applications</h1>
      {sp.deleted ? <Notice tone="good">Application deleted.</Notice> : null}
      <p className="text-sm text-ink-muted">Offers of help from the public form. Applicants have no login and haven&apos;t been invited to anything.</p>
      <nav aria-label="Application stages" className="flex flex-wrap gap-2 text-sm">
        {[{ code: "open", label: "Open" }, ...STAGES].map((x) => (
          <Link key={x.code} href={`/manage/applications?stage=${x.code}`} aria-current={stage === x.code ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-3 ${stage === x.code ? "border-club bg-club font-semibold text-white" : "border-line bg-white text-club"}`}>
            {x.label}{x.code !== "open" ? ` (${count(x.code)})` : ""}
          </Link>
        ))}
      </nav>
      <form role="search" className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="stage" value={stage} />
        <Field label="Search"><Input name="q" defaultValue={q} placeholder="Name or email" /></Field>
        <Field label="Sort"><Select name="sort" defaultValue={s("sort") || "newest"}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></Select></Field>
        <div className="flex items-end"><button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-club">Apply</button></div>
      </form>
      {list.length === 0 ? <Card><p className="text-sm">{stage === "new" || stage === "open" ? "No new applications." : "None here."}</p></Card> : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/manage/applications/${a.id}`} className="font-semibold text-club-blue underline">{a.full_name}</Link>
                <Badge>{STAGES.find((x) => x.code === a.stage)?.label}</Badge>
                {a.duplicate_review_status === "possible_duplicate" ? <Badge tone="warn">Possible duplicate</Badge> : null}
                {a.linked_person_id ? <Badge tone="good">In directory</Badge> : null}
                {a.follow_up_on && a.follow_up_on <= today && !["closed", "accepted_to_pool"].includes(a.stage) ? <Badge tone="warn">Follow-up due</Badge> : null}
                {a.unsure_role ? <Badge tone="info">Help me find a role</Badge> : null}
              </div>
              <p className="text-xs text-ink-muted">Received {formatDay(new Date(a.created_at))}</p>
              {a.interests.length ? <p className="mt-1 flex flex-wrap gap-1">{a.interests.slice(0, 6).map((i) => <Badge key={i}>{interestLabel(i)}</Badge>)}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
