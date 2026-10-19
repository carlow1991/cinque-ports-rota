import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageLoading } from "@/components/app-header";
import { hubHomePath, requirePerson } from "@/lib/auth/dal";

export default function Home() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SendHome />
    </Suspense>
  );
}

async function SendHome(): Promise<null> {
  const me = await requirePerson();
  redirect(hubHomePath(me.level));
}
