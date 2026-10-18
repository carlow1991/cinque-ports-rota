import Link from "next/link";
import type { ReactNode } from "react";
import { ClubMark } from "@/components/club-mark";

/** `switcher` is an optional mode switch (organiser ↔ volunteer view) shown at the right. */
export function AppHeader({ title, homeHref, switcher }: { title: string; homeHref: string; switcher?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b-4 border-accent bg-club text-white print:hidden">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href={homeHref} className="flex items-center gap-2 rounded">
          <ClubMark size="sm" />
          <span className="text-base font-semibold leading-tight">
            Cinque Ports FC <span className="block text-xs font-normal opacity-90">{title}</span>
          </span>
        </Link>
        {switcher ? <div className="ml-auto">{switcher}</div> : null}
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
