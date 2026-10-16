import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireVolunteer } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Profile" };

const ROLE_LABEL = { admin: "Administrator", coordinator: "Coordinator", volunteer: "Volunteer" } as const;

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Profile />
    </Suspense>
  );
}

async function Profile() {
  const me = await requireVolunteer();
  return (
    <section aria-labelledby="profile-heading" className="space-y-4">
      <h1 id="profile-heading" className="text-2xl font-bold text-club">
        Profile
      </h1>
      <dl className="rounded-lg border border-line bg-white p-4">
        <dt className="text-sm text-ink-muted">Name</dt>
        <dd className="mb-3 font-semibold">{me.displayName}</dd>
        <dt className="text-sm text-ink-muted">Access</dt>
        <dd className="font-semibold">{ROLE_LABEL[me.role]}</dd>
      </dl>
      {MANAGER_ROLES.includes(me.role) ? (
        <Link
          href="/manage"
          className="block rounded-lg bg-club px-4 py-3 text-center font-semibold text-white hover:bg-club-hover"
        >
          Go to organiser area
        </Link>
      ) : null}
      <p className="text-sm text-ink-muted">
        The rota stores only your name, email, an optional phone number and your duties. Other volunteers can never
        see your email or phone number.
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
  );
}
