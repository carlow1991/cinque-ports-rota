import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { requireVolunteer } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Rota" };

export default function RotaPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Rota />
    </Suspense>
  );
}

async function Rota() {
  const me = await requireVolunteer();
  return (
    <section aria-labelledby="rota-heading" className="space-y-3">
      <h1 id="rota-heading" className="text-2xl font-bold text-club">
        Rota
      </h1>
      <p>Hello {me.displayName}.</p>
      <p className="rounded-lg border border-dashed border-line bg-white p-4 text-ink-muted">
        Upcoming events and open duties will appear here once events are set up.
      </p>
    </section>
  );
}
