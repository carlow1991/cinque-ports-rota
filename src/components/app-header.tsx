import Link from "next/link";
import { ClubMark } from "@/components/club-mark";

export function AppHeader({ title, homeHref }: { title: string; homeHref: string }) {
  return (
    <header className="sticky top-0 z-10 bg-club text-white">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href={homeHref} className="flex items-center gap-2 rounded">
          <ClubMark size="sm" />
          <span className="text-base font-semibold leading-tight">
            Cinque Ports FC <span className="block text-xs font-normal opacity-90">{title}</span>
          </span>
        </Link>
      </div>
    </header>
  );
}

export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="py-10 text-center text-ink-muted">
      {label}
    </p>
  );
}
