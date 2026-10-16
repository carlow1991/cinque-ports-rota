import type { Metadata } from "next";
import { ClubMark } from "@/components/club-mark";

export const metadata: Metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <section className="w-full max-w-sm rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <ClubMark size="sm" />
          <h1 className="text-xl font-bold text-club">Your account isn&apos;t active</h1>
        </div>
        <p className="mb-4 text-ink">
          You&apos;re signed in, but this email isn&apos;t set up for the volunteer rota, or the account has been paused.
          Please contact a club organiser if you think this is a mistake.
        </p>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full rounded-lg border border-line bg-white px-4 py-3 font-semibold text-club hover:bg-surface-muted"
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}
