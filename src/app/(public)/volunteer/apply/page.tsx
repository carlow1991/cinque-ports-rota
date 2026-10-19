import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { loadClubContact, loadPublicOpportunities } from "@/lib/supabase/service";
import { ApplyForm } from "./apply-form";

export const metadata: Metadata = { title: "Offer to volunteer · Cinque Ports FC" };

/** Public, no-login application. Three short steps; no account is created. */
export default function ApplyPage(props: PageProps<"/volunteer/apply">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-club">Offer to volunteer</h1>
      <p className="text-sm text-ink-muted">Three short steps, about five minutes. No account needed.</p>
      <Suspense fallback={<PageLoading />}><Form {...props} /></Suspense>
    </div>
  );
}

async function Form({ searchParams }: PageProps<"/volunteer/apply">) {
  const sp = await searchParams;
  const [roles, contact] = await Promise.all([loadPublicOpportunities(), loadClubContact()]);
  return <ApplyForm roles={(roles ?? []).map((r) => ({ id: r.id, title: r.title }))} preselect={typeof sp.role === "string" ? sp.role : undefined} clubContact={contact} />;
}
