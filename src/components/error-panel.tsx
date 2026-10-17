"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/**
 * Friendly error screen used by the error boundaries. Never shows the error message or stack
 * (which can contain internal details); only the digest, so the club can match it to server logs.
 */
export function ErrorPanel({ error, retry, home = "/rota", homeLabel = "Back to the rota" }: {
  error: Error & { digest?: string }; retry: () => void; home?: string; homeLabel?: string;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <section role="alert" aria-labelledby="error-title" className="mx-auto w-full max-w-md space-y-3 py-6">
      <h1 id="error-title" ref={heading} tabIndex={-1} className="text-2xl font-bold text-club outline-none">Something went wrong</h1>
      <p>We couldn&apos;t load this page. Nothing you did has been lost: any change you saw confirmed was saved.</p>
      <p>Please try again. If it keeps happening, tell your organiser{error.digest ? <> and quote reference <code className="rounded bg-surface-muted px-1">{error.digest}</code></> : null}.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => retry()} className="inline-flex min-h-11 items-center rounded-lg bg-club px-4 font-semibold text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent">
          Try again
        </button>
        <Link href={home} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 font-semibold text-club">{homeLabel}</Link>
      </div>
    </section>
  );
}
