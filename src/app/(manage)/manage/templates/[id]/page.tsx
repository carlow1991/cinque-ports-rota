import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth/dal";
import { loadDutyTypes, loadTemplates } from "@/lib/data/manage";
import { describeTiming } from "@/lib/domain/template-timing";
import { TimingFields } from "./timing-fields";
import { addTemplateItemAction, deleteTemplateItemAction, updateTemplateAction, updateTemplateItemAction } from "../actions";

export const metadata: Metadata = { title: "Edit template" };

export default function EditTemplatePage({ params }: PageProps<"/manage/templates/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditTemplate params={params} />
    </Suspense>
  );
}

async function EditTemplate({ params }: { params: PageProps<"/manage/templates/[id]">["params"] }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const [templates, duties] = await Promise.all([loadTemplates({ includeInactive: true }), loadDutyTypes()]);
  const t = templates.find((x) => x.id === id);
  if (!t) notFound();

  return (
    <section className="space-y-4">
      <p><Link href="/manage/templates" className="text-sm text-club-blue underline">← All templates</Link></p>
      <h1 className="text-2xl font-bold text-club">{t.code}: {t.name}</h1>
      <Notice tone="info">
        Events created <strong>after</strong> you save use the new settings. Existing events keep their duties as they are, with one
        exception: if an existing event&apos;s date or times are changed later, its template duties are re-timed using this template&apos;s
        settings at that moment. The event page shows exactly what will change before anyone saves.
      </Notice>

      <Card title="Name and description">
        <p className="mb-2 text-sm text-ink-muted">Saving here changes only the name, description and whether the template is offered. Each duty below has its own Save button.</p>
        <ActionForm action={updateTemplateAction} submitLabel="Save name and description" variant="secondary" trackChanges>
          <input type="hidden" name="template_id" value={t.id} />
          <Field label="Name"><Input name="name" defaultValue={t.name} maxLength={120} required /></Field>
          <Field label="Description"><Textarea name="description" defaultValue={t.description ?? ""} maxLength={2000} /></Field>
          <Checkbox name="active" defaultChecked={t.active} label="Active (offered when creating events)" />
        </ActionForm>
      </Card>

      <section aria-labelledby="duties-h" className="space-y-2">
        <h2 id="duties-h" className="text-lg font-semibold text-club">Duties ({t.items.length})</h2>
        <p className="text-sm text-ink-muted">Open one duty at a time to change it.</p>
        {t.items.map((i) => (
          <details key={i.id} className="rounded-xl border border-line bg-white p-3">
            <summary className="cursor-pointer">
              <span className="font-semibold text-club">{i.dutyName}</span> · {i.requiredCount} {i.requiredCount === 1 ? "person" : "people"}{" "}
              {i.enabledByDefault ? <Badge tone="good">On by default</Badge> : <Badge>Optional</Badge>}
              <span className="block text-sm text-ink-muted">From {describeTiming(i.startAnchor, i.startOffsetMinutes)} until {describeTiming(i.endAnchor, i.endOffsetMinutes)}</span>
            </summary>
            <ActionForm action={updateTemplateItemAction} submitLabel="Save this duty" variant="secondary" className="mt-3 space-y-3" trackChanges>
              <input type="hidden" name="item_id" value={i.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="People"><Input type="number" name="required_count" min={1} max={50} defaultValue={i.requiredCount} /></Field>
                <div className="sm:col-span-2"><Checkbox name="enabled_by_default" defaultChecked={i.enabledByDefault} label="On by default" hint="Off = optional; only created when the organiser switches it on." /></div>
              </div>
              <TimingFields idPrefix={i.id} startAnchor={i.startAnchor} startOffset={i.startOffsetMinutes} endAnchor={i.endAnchor} endOffset={i.endOffsetMinutes} />
              <fieldset>
                <legend className="text-sm font-semibold">Also includes (same person, no extra places)</legend>
                <div className="grid sm:grid-cols-3">
                  {duties.filter((d) => d.code !== i.dutyCode).map((d) => (
                    <Checkbox key={d.code} name="responsibilities" value={d.code} defaultChecked={i.responsibilities.some((r) => r.code === d.code)} label={d.name} />
                  ))}
                </div>
              </fieldset>
              <Checkbox name="suppressed" defaultChecked={i.suppressedByLinkedCover} label="Don't create when the event is linked to venue-wide cover" hint="Use for site-lead style duties that venue cover replaces." />
              <Checkbox name="signup_enabled" defaultChecked={i.signupEnabled} label="Volunteers can sign up themselves" />
              <Checkbox name="approval_required" defaultChecked={i.approvalRequired} label="Sign-ups need organiser approval" />
              <div className="rounded-lg bg-surface-muted p-3">
                <Field label="Organiser guidance: when to switch this duty on" hint="Shown to organisers when creating an event. Never shown to volunteers.">
                  <Input name="when_to_enable" defaultValue={i.whenToEnable ?? ""} maxLength={500} />
                </Field>
              </div>
              <Field label="Instructions for volunteers" hint="Copied into each new duty created from this template. Volunteers see these.">
                <Textarea name="instructions" defaultValue={i.instructions ?? ""} maxLength={2000} />
              </Field>
            </ActionForm>
            <ActionForm action={deleteTemplateItemAction} submitLabel="Remove from template" variant="danger" className="mt-2" confirm="Remove this duty from the template? Existing events keep theirs.">
              <input type="hidden" name="item_id" value={i.id} />
            </ActionForm>
          </details>
        ))}
      </section>

      <Card title="Add a duty to this template">
        <ActionForm action={addTemplateItemAction} submitLabel="Add duty" variant="secondary">
          <input type="hidden" name="template_id" value={t.id} />
          <Field label="Duty">
            <Select name="duty_code">{duties.filter((d) => d.active).map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}</Select>
          </Field>
        </ActionForm>
      </Card>
    </section>
  );
}
