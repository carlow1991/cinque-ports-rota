import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { HubBottomNav, HubBottomNavLinks } from "@/components/hub-nav";
import { HUB_MANAGERS } from "@/lib/auth/access";
import { resolveHubAccess } from "@/lib/auth/dal";

/**
 * Static chrome only. Every page under this group checks access itself (layouts don't re-run
 * on client navigation), via requirePerson()/requireLevel() in src/lib/auth/dal.ts.
 */
export default function HubLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader title="Volunteer Hub" homeHref="/home"
        switcher={<Suspense fallback={null}><ManageSwitch /></Suspense>} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">{children}</main>
      <Suspense fallback={<HubBottomNavLinks pathname={null} />}>
        <HubBottomNav />
      </Suspense>
    </>
  );
}

/** Link to the organiser area, shown only to admins and coordinators (the pages re-check). */
async function ManageSwitch() {
  const a = await resolveHubAccess(HUB_MANAGERS);
  if (a.kind !== "allow") return null;
  return (
    <Link href="/manage" className="inline-flex min-h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold text-white hover:bg-white/10">
      Manage
    </Link>
  );
}
