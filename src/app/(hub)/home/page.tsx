import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Card } from "@/components/ui";
import { requirePerson } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return <Suspense fallback={<PageLoading />}><Home /></Suspense>;
}

async function Home() {
  const me = await requirePerson();
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Hello, {me.name.split(" ")[0]}</h1>
      <Card title="Nothing needs a reply">
        <p className="text-sm">When an organiser asks if you can help, it will appear here.</p>
      </Card>
      <p className="text-sm"><Link className="font-semibold text-club-blue underline" href="/calendar">See what&apos;s on</Link></p>
    </section>
  );
}
