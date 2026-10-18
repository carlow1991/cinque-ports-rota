import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BottomNav, BottomNavLinks } from "@/components/bottom-nav";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { resolveAccess } from "@/lib/auth/dal";

/**
 * Static chrome only. Authorisation is NOT done here: layouts don't re-render on
 * client navigation, so every page under this group checks access itself (see the DAL).
 */
export default function VolunteerLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader title="Volunteer Rota" homeHref="/rota"
        switcher={<Suspense fallback={null}><OrganiserSwitch /></Suspense>} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">{children}</main>
      <Suspense fallback={<BottomNavLinks pathname={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}

/** Mode switch back to the organiser area, shown only to admins and coordinators. A convenience
 *  link: /manage pages check the role again on every request. */
async function OrganiserSwitch() {
  const a = await resolveAccess(MANAGER_ROLES);
  if (a.kind !== "allow") return null;
  return (
    <Link href="/manage" className="inline-flex min-h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold text-white hover:bg-white/10">
      Organiser view
    </Link>
  );
}
