import Link from "next/link";
import { ClubMark } from "@/components/club-mark";

/** Public, no-login pages: volunteering opportunities, the application form and the privacy notice. */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="border-b-4 border-accent bg-club text-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/volunteer" className="flex items-center gap-2"><ClubMark size="sm" />
            <span className="font-semibold leading-tight">Cinque Ports FC <span className="block text-xs font-normal opacity-90">One Club. One Community. Together.</span></span>
          </Link>
          <nav aria-label="Public" className="ml-auto flex flex-wrap gap-x-3 text-sm">
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/volunteer">Opportunities</Link>
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/volunteer/apply">Apply</Link>
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/privacy">Privacy</Link>
            <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/login">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
