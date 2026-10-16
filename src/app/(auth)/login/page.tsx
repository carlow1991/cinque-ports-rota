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
          <ClubMark />
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
          <Suspense fallback={<LoginForm />}>
            <LoginFormWithError searchParams={searchParams} />
          </Suspense>
        </section>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Want to help out? Ask a club organiser to invite you.
        </p>
      </div>
    </main>
  );
}

async function LoginFormWithError({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const key = typeof sp.error === "string" ? sp.error : undefined;
  return <LoginForm initialError={key ? ERRORS[key] : undefined} />;
}
