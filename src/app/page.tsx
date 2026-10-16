import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/app-header";
import { homePathFor } from "@/lib/auth/access";
import { requireVolunteer } from "@/lib/auth/dal";

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SendHome />
    </Suspense>
  );
}

async function SendHome(): Promise<null> {
  const me = await requireVolunteer();
  redirect(homePathFor(me.role));
}
