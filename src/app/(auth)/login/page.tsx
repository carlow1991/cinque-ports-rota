import type { Metadata } from "next";
import { Suspense } from "react";
import { ClubMark } from "@/components/club-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Request a new code below.",
  access:
    "Your email is verified, but it isn't set up for the rota or the account is paused. Please contact a club organiser.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <ClubMark size="lg" />
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Cinque Ports FC</p>
            <h1 className="text-2xl font-bold text-club">Volunteer Rota</h1>
          </div>
        </div>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
          <p className="mb-4 text-sm text-ink-muted">
            The rota is for invited club volunteers. We&apos;ll email you a one-time code, so there&apos;s no password to remember.
          </p>
          {/* The error notice depends on the URL and streams in separately; the form itself is part of
              the static page so a tap before JavaScript has loaded still works (progressive enhancement). */}
          <Suspense fallback={null}>
            <LinkError searchParams={searchParams} />
          </Suspense>
          <LoginForm />
        </section>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Want to help out? <a href="/volunteer/apply" className="font-semibold text-club-blue underline">Offer to volunteer</a>.
        </p>
        <p className="mt-2 text-center text-sm">
          <a href="/help#problems" className="font-semibold text-club-blue underline">Trouble signing in? Read the quick guide</a>
        </p>
      </div>
    </main>
  );
}

async function LinkError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const message = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-red-50 p-3 text-sm font-medium text-danger">
      {message}
    </p>
  );
}
