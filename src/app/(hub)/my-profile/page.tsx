import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Field, Input } from "@/components/ui";
import { ContactChannelsField } from "@/components/hub/contact-channels";
import { PreferencesFields } from "@/components/hub/person-fields";
import { requirePerson } from "@/lib/auth/dal";
import { loadPerson } from "@/lib/data/hub";
import { formatPhone } from "@/lib/domain/hub-tags";
import { updateMyPreferencesAction, updateMyProfileAction } from "../actions";

export const metadata: Metadata = { title: "My Profile" };

const LEVEL = { admin: "Administrator", coordinator: "Coordinator", member: "Member" } as const;

export default function MyProfilePage() {
  return <Suspense fallback={<PageLoading />}><MyProfile /></Suspense>;
}

async function MyProfile() {
  const me = await requirePerson();
  const { person: p, prefs, slots, teams } = await loadPerson(me.id);
  if (!p) return null;
  return (
    <section aria-labelledby="h" className="space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">My Profile</h1>
      <Card title="Your details">
        <ActionForm action={updateMyProfileAction} submitLabel="Save">
          <Field label="Name shown in the Hub" hint="Leave blank to use your full name.">
            <Input name="display_name" defaultValue={p.display_name ?? ""} maxLength={80} autoComplete="nickname" />
          </Field>
          <Field label="Phone (optional)" hint="Organisers can see it. Members only see it if you share it below.">
            <Input name="phone" type="tel" inputMode="tel" defaultValue={formatPhone(p.phone_normalized)} maxLength={30} autoComplete="tel" />
          </Field>
          <ContactChannelsField selected={p.contact_channels} legend="Ways you're happy to be contacted" />
          {p.is_under_18 ? null : (
            <>
              <Checkbox name="share_email_with_members" defaultChecked={p.share_email_with_members} label="Show my email to other signed-in members" />
              <Checkbox name="share_phone_with_members" defaultChecked={p.share_phone_with_members} label="Show my phone to other signed-in members" />
            </>
          )}
        </ActionForm>
        <dl className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
          <div><dt className="text-ink-muted">Email (used to sign in)</dt><dd className="break-all font-semibold">{p.email_normalized}</dd></div>
          <div><dt className="text-ink-muted">Access</dt><dd className="font-semibold">{LEVEL[me.level]}</dd></div>
          {teams.filter((t) => !t.active_to).length ? (
            <div><dt className="text-ink-muted">Teams</dt><dd>{teams.filter((t) => !t.active_to).map((t) => `${t.role_label}, ${t.teams?.name}`).join(" · ")}</dd></div>
          ) : null}
        </dl>
        <p className="mt-2 text-xs text-ink-muted">To change your email address or team, ask a club administrator.</p>
      </Card>
      <Card title="How you'd like to help">
        <ActionForm action={updateMyPreferencesAction} submitLabel="Save" variant="secondary" trackChanges>
          <PreferencesFields prefs={prefs} slots={slots} mine />
        </ActionForm>
      </Card>
      <form action="/auth/signout" method="post">
        <button className="min-h-11 w-full rounded-lg border border-line bg-white px-4 font-semibold text-club">Sign out</button>
      </form>
    </section>
  );
}
