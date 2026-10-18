import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ManageNav, ManageNavLinks } from "@/components/manage-nav";

/**
 * Static organiser chrome. Each page under /manage enforces admin/coordinator access itself
 * (layouts don't re-run on client navigation). The mode switch only changes what is shown:
 * the volunteer pages apply their own access rules, so it never grants anything.
 */
export default function ManageLayout({ children }: LayoutProps<"/manage">) {
  return (
    <>
      <AppHeader title="Organiser area" homeHref="/manage"
        switcher={<Link href="/rota" className="inline-flex min-h-11 items-center rounded-lg border border-white/60 px-3 text-sm font-semibold text-white hover:bg-white/10">Volunteer view</Link>} />
      <div className="border-b border-line bg-white print:hidden">
        <Suspense fallback={<ManageNavLinks pathname={null} />}>
          <ManageNav />
        </Suspense>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </>
  );
}
