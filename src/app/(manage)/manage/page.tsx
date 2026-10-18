import type { Metadata } from "next";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Card, LinkButton } from "@/components/ui";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadDirectory } from "@/lib/data/hub";

export const metadata: Metadata = { title: "Manage" };

export default function ManagePage() {
  return <Suspense fallback={<PageLoading />}><Overview /></Suspense>;
}

async function Overview() {
  const me = await requireLevel(HUB_MANAGERS);
  const people = await loadDirectory();
  return (
    <section aria-labelledby="h" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">Overview</h1>
        {me.level === "admin" ? <LinkButton href="/manage/people/new">+ Person</LinkButton> : null}
      </div>
      <Card title="People">
        <p className="text-sm">{people.length} in the directory.</p>
      </Card>
    </section>
  );
}
