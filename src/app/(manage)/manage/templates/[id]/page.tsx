import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Card, Checkbox, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { requireRole } from "@/lib/auth/dal";
import { loadDutyTypes, loadTemplates } from "@/lib/data/manage";
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
      <Notice tone="info">Changes apply to events created <strong>after</strong> saving. Existing events and their duties are never changed by editing a template.</Notice>

      <Card title="Template">
        <ActionForm action={updateTemplateAction} submitLabel="Save template" variant="secondary">
          <input type="hidden" name="template_id" value={t.id} />
          <Field label="Name"><Input name="name" defaultValue={t.name} maxLength={120} required /></Field>
          <Field label="Description"><Textarea name="description" defaultValue={t.description ?? ""} maxLength={2000} /></Field>
          <Checkbox name="active" defaultChecked={t.active} label="Active (offered when creating events)" />
        </ActionForm>
      </Card>

      {t.items.map((i) => (
        <Card key={i.id} title={i.dutyName}>
          <ActionForm action={updateTemplateItemAction} submitLabel="Save duty" variant="secondary">
            <input type="hidden" name="item_id" value={i.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="People"><Input type="number" name="required_count" min={1} max={50} defaultValue={i.requiredCount} /></Field>
              <div className="sm:col-span-2"><Checkbox name="enabled_by_default" defaultChecked={i.enabledByDefault} label="On by default" hint="Off = optional; only created when the organiser switches it on." /></div>
              <Field label="Starts">
                <div className="flex gap-2">
                  <Input type="number" name="start_offset" defaultValue={i.startOffsetMinutes} min={-1440} max={1440} className="w-24" aria-label="Start offset in minutes" />
                  <Select name="start_anchor" defaultValue={i.startAnchor} aria-label="Start anchor">
                    <option value="event_start">min from event start</option>
                    <option value="event_end">min from event end</option>
                  </Select>
                </div>
              </Field>
              <Field label="Ends" hint="Negative = before, positive = after.">
                <div className="flex gap-2">
                  <Input type="number" name="end_offset" defaultValue={i.endOffsetMinutes} min={-1440} max={1440} className="w-24" aria-label="End offset in minutes" />
                  <Select name="end_anchor" defaultValue={i.endAnchor} aria-label="End anchor">
                    <option value="event_start">min from event start</option>
                    <option value="event_end">min from event end</option>
                  </Select>
                </div>
              </Field>
            </div>
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
            <Field label="When to switch it on (guidance)"><Input name="when_to_enable" defaultValue={i.whenToEnable ?? ""} maxLength={500} /></Field>
            <Field label="Instructions copied to each duty"><Textarea name="instructions" defaultValue={i.instructions ?? ""} maxLength={2000} /></Field>
          </ActionForm>
          <ActionForm action={deleteTemplateItemAction} submitLabel="Remove from template" variant="danger" className="mt-2" confirm="Remove this duty from the template? Existing events keep theirs.">
            <input type="hidden" name="item_id" value={i.id} />
          </ActionForm>
        </Card>
      ))}

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
