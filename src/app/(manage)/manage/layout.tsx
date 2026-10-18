import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { HubManageNav, HubManageNavLinks } from "@/components/hub-nav";
import { resolveHubAccess } from "@/lib/auth/dal";

/**
 * Static organiser chrome. Each page under /manage enforces organiser access itself
 * (layouts don't re-run on client navigation). The "Hub" link only changes what is shown.
 */
export default function ManageLayout({ children }: LayoutProps<"/manage">) {
  return (
    <>
      <AppHeader title="Manage" homeHref="/manage"
        switcher={<Link href="/home" className="inline-flex min-h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold text-white hover:bg-white/10">My Hub</Link>} />
      <div className="border-b border-line bg-white print:hidden">
        <Suspense fallback={<HubManageNavLinks pathname={null} isAdmin={false} />}>
          <Nav />
        </Suspense>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </>
  );
}

async function Nav() {
  const a = await resolveHubAccess();
  return <HubManageNav isAdmin={a.kind === "allow" && a.person.level === "admin"} />;
}
