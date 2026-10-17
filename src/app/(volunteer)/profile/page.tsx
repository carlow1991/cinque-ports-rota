import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Field, Input, Select } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireVolunteer } from "@/lib/auth/dal";
import { loadMyProfile } from "@/lib/data/volunteer";
import { updateProfileAction } from "../actions";

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
  const { me: p, venues } = await loadMyProfile(me.id);

  return (
    <section aria-labelledby="profile-heading" className="space-y-4">
      <h1 id="profile-heading" className="text-2xl font-bold text-club">Profile</h1>

      <Card title="Your details">
        <ActionForm action={updateProfileAction} submitLabel="Save">
          <Field label="Name shown on the rota" hint="Other volunteers on the same event see this name. Nothing else about you.">
            <Input name="display_name" defaultValue={p.display_name} required maxLength={80} autoComplete="name" />
          </Field>
          <Field label="Phone number (optional)" hint="Only organisers of events you're on can see it. Useful if plans change on the day.">
            <Input name="phone" type="tel" defaultValue={p.phone ?? ""} maxLength={30} autoComplete="tel" inputMode="tel" />
          </Field>
          <Field label="Venue you usually help at (optional)">
            <Select name="preferred_venue_id" defaultValue={p.preferred_venue_id ?? ""}>
              <option value="">No preference</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </Field>
        </ActionForm>
      </Card>

      <Card title="Account">
        <dl className="space-y-2 text-sm">
          <div><dt className="text-ink-muted">Email (used to sign in)</dt><dd className="break-all font-semibold">{p.email}</dd></div>
          <div><dt className="text-ink-muted">Access</dt><dd className="font-semibold">{ROLE_LABEL[me.role]}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-ink-muted">To change your email address, ask a club administrator.</p>
        {MANAGER_ROLES.includes(me.role) ? (
          <Link href="/manage" className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-club px-4 font-semibold text-white hover:bg-club-hover">
            Go to organiser area
          </Link>
        ) : null}
      </Card>

      <Card title="Your privacy">
        <ul className="list-inside list-disc space-y-1 text-sm">
          <li>The rota stores your name, email, optional phone number and the duties you sign up for.</li>
          <li>Other volunteers only ever see your display name, and only on events you&apos;re both on.</li>
          <li>Your email and phone are visible only to club organisers for events you&apos;re on.</li>
          <li>The rota does not hold DBS or safeguarding records. Club authorisations for keyholder duties are a yes/no flag only.</li>
        </ul>
      </Card>

      <form action="/auth/signout" method="post">
        <button type="submit" className="min-h-11 w-full rounded-lg border border-line bg-white px-4 py-3 font-semibold text-club hover:bg-surface-muted">
          Sign out
        </button>
      </form>
    </section>
  );
}
