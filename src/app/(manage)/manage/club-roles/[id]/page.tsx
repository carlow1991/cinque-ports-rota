import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { PositionFields } from "@/components/hub/position-fields";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadPositions } from "@/lib/data/hub";
import { loadPicker } from "@/lib/data/hub-involvement";
import { INTEREST_STAGES, OCCUPANCY_LABEL, recruitingLabels } from "@/lib/domain/positions";
import { addHolderAction, endHolderAction, savePositionAction, setInterestAction, setRecruitingAction } from "../actions";

export const metadata: Metadata = { title: "Club role" };

export default function ClubRolePage(props: PageProps<"/manage/club-roles/[id]">) {
  return <Suspense fallback={<PageLoading />}><ClubRole {...props} /></Suspense>;
}

async function ClubRole({ params }: PageProps<"/manage/club-roles/[id]">) {
  await requireLevel(HUB_ADMIN);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [positions, people] = await Promise.all([loadPositions(), loadPicker()]);
  const p = positions.find((x) => x.id === id);
  if (!p) notFound();
  return (
    <section aria-labelledby="h" className="mx-auto max-w-3xl space-y-4">
      <p><Link href="/manage/club-roles" className="text-sm font-semibold text-club-blue underline">← Club roles</Link></p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">{p.title}</h1>
        <Badge tone={p.occupancy === "vacant" ? "warn" : "neutral"}>{OCCUPANCY_LABEL[p.occupancy]}</Badge>
        {recruitingLabels(p).map((l) => <Badge key={l} tone="info">{l}</Badge>)}
      </div>
      {p.requires_external_safeguarding_review ? <Notice tone="warn">This role needs external checks. The Hub doesn&apos;t record them; appointments follow the club&apos;s and the FA&apos;s own process.</Notice> : null}

      <Card title="Recruiting">
        <p className="mb-2 text-sm text-ink-muted">Separate from who holds the role — the current holders stay in post.</p>
        <ActionForm action={setRecruitingAction} submitLabel="Save recruiting" variant="secondary">
          <input type="hidden" name="position_id" value={p.id} />
          <Checkbox name="seeking_replacement" label="Seeking a replacement / successor" defaultChecked={p.seeking_replacement} />
          <Checkbox name="seeking_additional_help" label="Need additional help" defaultChecked={p.seeking_additional_help} />
          <Checkbox name="publish_vacancy" label="Advertise as a vacancy (when nobody holds it)" defaultChecked={p.publish_vacancy} />
        </ActionForm>
        <p className="mt-2 text-xs text-ink-muted">{p.public_reason ? "Showing on the public volunteer page now." : p.public_visible ? "Allowed on the public page, but not shown because it isn't recruiting." : "Not on the public page (turn on “Can appear on the public volunteer page” below)."}</p>
      </Card>

      <Card title="Current holders">
        {p.holders.length === 0 ? <p className="text-sm">Nobody at the moment.</p> : (
          <ul className="space-y-2">
            {p.holders.map((h) => (
              <li key={h.id} className="rounded-lg border border-line p-3">
                <p className="font-semibold">{h.name} <span className="text-sm font-normal text-ink-muted">{h.capacity !== "holder" ? `(${h.capacity}) ` : ""}since {h.start_date}</span></p>
                <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Hand over / end</summary>
                  <ActionForm action={endHolderAction} submitLabel="End holding" variant="secondary">
                    <input type="hidden" name="holder_id" value={h.id ?? ""} />
                    <Field label="Last day (blank = today)"><Input name="end_date" type="date" /></Field>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 rounded-lg border border-line p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Add a holder</summary>
          <ActionForm action={addHolderAction} submitLabel="Add">
            <input type="hidden" name="position_id" value={p.id} />
            <Field label="Person"><Select name="person_id" required defaultValue=""><option value="" disabled>Choose</option>{people.map((x) => <option key={x.person_id} value={x.person_id}>{x.name}</option>)}</Select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Since"><Input name="start_date" type="date" /></Field>
              <Field label="As"><Select name="capacity" defaultValue="holder"><option value="holder">Holder</option><option value="joint">Joint holder</option><option value="acting">Acting</option><option value="support">Support</option></Select></Field>
            </div>
          </ActionForm>
        </details>
        {p.history?.length ? (
          <div className="mt-3"><p className="text-sm font-semibold">Previously</p>
            <ul className="text-sm text-ink-muted">{p.history.map((h) => <li key={h.id}>{h.name} · {h.start_date} – {h.end_date}</li>)}</ul></div>
        ) : null}
      </Card>

      <Card title="Interest and succession">
        {!p.interests?.length ? <p className="text-sm text-ink-muted">No one has shown interest yet.</p> : (
          <ul className="space-y-2">
            {p.interests.map((i) => (
              <li key={i.id} className="rounded-lg border border-line p-3">
                <ActionForm action={setInterestAction} submitLabel="Save" variant="secondary">
                  <input type="hidden" name="interest_id" value={i.id} /><input type="hidden" name="position_id" value={p.id} />
                  <p className="font-semibold">{i.name ?? (i.application_id ? <Link className="text-club-blue underline" href={`/manage/applications/${i.application_id}`}>Applicant</Link> : "Someone")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Stage"><Select name="stage" defaultValue={i.stage}>{INTEREST_STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</Select></Field>
                    <Field label="Note"><Input name="note" maxLength={1000} defaultValue={i.note ?? ""} /></Field>
                  </div>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 rounded-lg border border-line p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">Add someone who&apos;s interested</summary>
          <ActionForm action={setInterestAction} submitLabel="Add">
            <input type="hidden" name="position_id" value={p.id} /><input type="hidden" name="stage" value="interested" />
            <Field label="Person"><Select name="person_id" required defaultValue=""><option value="" disabled>Choose</option>{people.map((x) => <option key={x.person_id} value={x.person_id}>{x.name}</option>)}</Select></Field>
          </ActionForm>
        </details>
      </Card>

      <Card title="Details">
        <ActionForm action={savePositionAction} submitLabel="Save details" trackChanges>
          <input type="hidden" name="position_id" value={p.id} />
          <PositionFields p={p} people={people} />
        </ActionForm>
      </Card>
    </section>
  );
}
