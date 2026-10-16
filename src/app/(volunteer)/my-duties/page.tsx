import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { requireVolunteer } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "My Duties" };

export default function MyDutiesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MyDuties />
    </Suspense>
  );
}

async function MyDuties() {
  await requireVolunteer();
  return (
    <section aria-labelledby="duties-heading" className="space-y-3">
      <h1 id="duties-heading" className="text-2xl font-bold text-club">
        My Duties
      </h1>
      <p className="rounded-lg border border-dashed border-line bg-white p-4 text-ink-muted">
        You haven&apos;t got any duties yet.
      </p>
    </section>
  );
}
