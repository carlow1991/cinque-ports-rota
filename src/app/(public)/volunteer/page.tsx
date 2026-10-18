import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card } from "@/components/ui";
import { PageLoading } from "@/components/app-header";
import { loadPublicOpportunities } from "@/lib/supabase/service";
import { LOCATION_LABEL, PUBLIC_REASON_LABEL } from "@/lib/domain/positions";

export const metadata: Metadata = { title: "Volunteer with Cinque Ports FC", description: "Help at Cinque Ports FC — no football experience needed." };

/** Public recruitment landing. Shows only deliberately advertised roles, never names or contacts. */
export default function VolunteerLanding() {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h1 className="text-3xl font-bold text-club">Volunteer with Cinque Ports FC</h1>
        <p className="text-lg font-semibold">One Club. One Community. Together.</p>
        <p>The club runs on volunteers — on matchdays, around the ground, behind the scenes and online. No football experience needed, and one-off help is just as welcome as something regular.</p>
        <Link href="/volunteer/apply" className="inline-flex min-h-12 items-center rounded-lg bg-club px-5 text-lg font-semibold text-white hover:bg-club-hover">Offer to volunteer</Link>
        <p className="text-sm text-ink-muted">Not sure what you&apos;d like to do? That&apos;s fine — the form has a “help me find a role” option.</p>
      </section>
      <Suspense fallback={<PageLoading label="Loading roles…" />}><Roles /></Suspense>
    </div>
  );
}

async function Roles() {
  const roles = await loadPublicOpportunities();
  return (
    <section aria-labelledby="roles" className="space-y-3">
      <h2 id="roles" className="text-xl font-bold text-club">Roles we&apos;re looking for help with</h2>
      {roles === null ? <p className="text-sm text-ink-muted">The list of roles isn&apos;t available right now — you can still offer to help.</p>
        : roles.length === 0 ? <p className="text-sm text-ink-muted">No specific roles are advertised at the moment — you can still offer to help.</p>
        : roles.map((r) => (
          <Card key={r.id} title={r.title}>
            <p><Badge tone="info">{PUBLIC_REASON_LABEL[r.reason]}</Badge></p>
            {r.summary ? <p className="mt-2 text-sm">{r.summary}</p> : null}
            <p className="mt-1 text-xs text-ink-muted">{[r.department, r.commitment, r.location ? LOCATION_LABEL[r.location] : null, r.training_available ? "Training offered" : null,
              r.checks_needed ? "Club and FA checks apply" : null].filter(Boolean).join(" · ")}</p>
            <Link className="mt-2 inline-flex min-h-11 items-center font-semibold text-club-blue underline" href={`/volunteer/apply?role=${r.id}`}>I&apos;m interested</Link>
          </Card>
        ))}
    </section>
  );
}
