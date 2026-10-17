import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { resolveAccess } from "@/lib/auth/dal";

/**
 * Static organiser chrome. Each page under /manage enforces admin/coordinator access itself
 * (layouts don't re-run on client navigation). The Settings link is only a convenience; the
 * settings page itself refuses non-admins.
 */
const LINKS = [
  { href: "/manage", label: "Dashboard" },
  { href: "/manage/approvals", label: "Needs action" },
  { href: "/manage/coverage", label: "Coverage" },
  { href: "/manage/calendar", label: "Calendar" },
  { href: "/manage/events/new", label: "New event" },
  { href: "/manage/volunteers", label: "Volunteers" },
  { href: "/manage/templates", label: "Templates" },
];

export default function ManageLayout({ children }: LayoutProps<"/manage">) {
  return (
    <>
      <AppHeader title="Organiser area" homeHref="/manage" />
      <div className="border-b border-line bg-white print:hidden">
        <nav aria-label="Organiser" className="mx-auto flex max-w-5xl flex-wrap gap-x-1 px-2 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap px-2 py-2.5 font-semibold text-club hover:underline">
              {l.label}
            </Link>
          ))}
          <Suspense fallback={null}>
            <AdminLink />
          </Suspense>
          <Link href="/rota" className="whitespace-nowrap px-2 py-2.5 text-club-blue underline sm:ml-auto">
            Volunteer view
          </Link>
        </nav>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </>
  );
}

async function AdminLink() {
  const a = await resolveAccess(["admin"]);
  if (a.kind !== "allow") return null;
  return (
    <Link href="/manage/settings" className="whitespace-nowrap px-2 py-2.5 font-semibold text-club hover:underline">
      Settings
    </Link>
  );
}
