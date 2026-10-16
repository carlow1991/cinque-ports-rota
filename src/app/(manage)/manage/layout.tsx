import Link from "next/link";
import { AppHeader } from "@/components/app-header";

/** Static organiser chrome. Each page under /manage enforces admin/coordinator access itself. */
export default function ManageLayout({ children }: LayoutProps<"/manage">) {
  return (
    <>
      <AppHeader title="Organiser area" homeHref="/manage" />
      <div className="border-b border-line bg-white">
        <nav aria-label="Organiser" className="mx-auto flex max-w-5xl gap-4 overflow-x-auto px-4 py-2 text-sm">
          <Link href="/manage" className="whitespace-nowrap font-semibold text-club">
            Dashboard
          </Link>
          <Link href="/rota" className="whitespace-nowrap text-ink-muted">
            Volunteer view
          </Link>
        </nav>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-4">{children}</main>
    </>
  );
}
