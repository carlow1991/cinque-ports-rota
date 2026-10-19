import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Notice } from "@/components/ui";
import { PersonCoreFields, PersonMoreFields } from "@/components/hub/person-fields";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { authInvitesEnabled } from "@/lib/supabase/admin";
import { createPersonAction } from "../actions";

export const metadata: Metadata = { title: "Add person" };

export default function NewPersonPage() {
  return <Suspense fallback={<PageLoading />}><NewPerson /></Suspense>;
}

async function NewPerson() {
  await requireLevel(HUB_ADMIN);
  return (
    <section aria-labelledby="h" className="mx-auto max-w-2xl space-y-4">
      <h1 id="h" className="text-2xl font-bold text-club">Add person</h1>
      <p className="text-sm text-ink-muted">Only a name is needed. Saving adds them to the directory and sends nothing.</p>
      <Card>
        <ActionForm action={createPersonAction} submitLabel="Save person" pendingLabel="Saving…">
          <PersonCoreFields />
          <div className="space-y-1 rounded-lg bg-surface-muted p-3">
            <Checkbox name="send_invite_now" label="Send portal invitation now"
              hint={authInvitesEnabled()
                ? "Off by default. Needs an email. Emails them a link to sign in to the Hub."
                : "Off by default. Invitation emails are switched off on this site, so this would be recorded as “not sent”."} />
            <Checkbox name="routine_requests_enabled" label="Include in suggested availability recipients"
              hint="Off by default. They'll be pre-ticked when you ask for availability for an event. Nothing is ever sent until you press Send." />
          </div>
          <PersonMoreFields />
        </ActionForm>
      </Card>
      <Notice tone="info">Teams, club roles, interests and portal access can be added on the next screen.</Notice>
    </section>
  );
}
