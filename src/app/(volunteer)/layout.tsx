import { AppHeader } from "@/components/app-header";
import { Suspense } from "react";
import { BottomNav, BottomNavLinks } from "@/components/bottom-nav";

/**
 * Static chrome only. Authorisation is NOT done here: layouts don't re-render on
 * client navigation, so every page under this group checks access itself (see the DAL).
 */
export default function VolunteerLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader title="Volunteer Rota" homeHref="/rota" />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-24 pt-4">{children}</main>
      <Suspense fallback={<BottomNavLinks pathname={null} />}>
        <BottomNav />
      </Suspense>
    </>
  );
}
