import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Organiser dashboard" };

export default function ManagePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const me = await requireRole(MANAGER_ROLES);
  return (
    <section aria-labelledby="manage-heading" className="space-y-3">
      <h1 id="manage-heading" className="text-2xl font-bold text-club">
        Organiser dashboard
      </h1>
      <p>Signed in as {me.displayName}.</p>
      <p className="rounded-lg border border-dashed border-line bg-white p-4 text-ink-muted">
        Staffing, coverage and event tools will appear here in later phases.
      </p>
    </section>
  );
}
