import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { ActionForm } from "@/components/action-form";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, Checkbox, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { loadPositions } from "@/lib/data/hub";
import { STAGES, loadApplication, loadPeopleByIds } from "@/lib/data/hub-applications";
import { loadPicker } from "@/lib/data/hub-involvement";
import { CONNECTIONS, HEARD_FROM } from "@/lib/domain/application-form";
import { COMMITMENT_BUCKETS, COMMITMENT_PATTERNS, DAYPARTS, DAYS, LOCATION_PREFS, STRENGTHS, formatPhone, interestLabel, labelFor } from "@/lib/domain/hub-tags";
import { formatLongDay } from "@/lib/time/london";
import { createPersonFromApplicationAction, deleteApplicationAction, linkApplicationAction, matchPositionAction, updateApplicationAction } from "../actions";

export const metadata: Metadata = { title: "Application" };

export default function ApplicationPage(props: PageProps<"/manage/applications/[id]">) {
  return <Suspense fallback={<PageLoading />}><ApplicationDetail {...props} /></Suspense>;
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid gap-1 py-1 sm:grid-cols-3"><dt className="text-sm text-ink-muted">{k}</dt><dd className="text-sm sm:col-span-2">{v || "—"}</dd></div>;
}

async function ApplicationDetail({ params }: PageProps<"/manage/applications/[id]">) {
  await requireLevel(HUB_ADMIN);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { app: a, suggestions } = await loadApplication(id);
  if (!a) notFound();
  const [positions, picker, dupPeople] = await Promise.all([loadPositions(), loadPicker(),
    loadPeopleByIds(a.duplicate_candidates.filter((d) => d.kind === "person").map((d) => d.id))]);
  const title = (pid: string) => positions.find((p) => p.id === pid)?.title ?? "Role";
  const slots = a.availability.map((s) => `${DAYS[s.day]} ${labelFor(DAYPARTS, s.daypart).toLowerCase()}`).join(", ");

  return (
    <section aria-labelledby="h" className="mx-auto max-w-3xl space-y-4">
      <p><Link href="/manage/applications" className="text-sm font-semibold text-club-blue underline">← Applications</Link></p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 id="h" className="text-2xl font-bold text-club">{a.full_name}</h1>
        <Badge>{STAGES.find((x) => x.code === a.stage)?.label}</Badge>
        {a.linked_person_id ? <Link href={`/manage/people/${a.linked_person_id}`}><Badge tone="good">In directory — open</Badge></Link> : null}
      </div>
      <p className="text-sm text-ink-muted">Received {formatLongDay(new Date(a.created_at))}. No login, no invitation and no role have been given.</p>

      {a.duplicate_review_status === "possible_duplicate" ? (
        <Card title="Possible duplicate">
          <p className="mb-2 text-sm">The same email or phone is already known. Compare before linking — nothing has been merged or changed.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line p-3 text-sm"><p className="font-semibold">This application</p><p>{a.full_name}</p><p>{a.email_normalized}</p><p>{formatPhone(a.phone_normalized)}</p></div>
            {dupPeople.map((p) => (
              <div key={p.id} className="rounded-lg border border-amber-600/40 bg-amber-50 p-3 text-sm">
                <p className="font-semibold">In the directory</p><p>{p.display_name ?? p.full_name}</p><p>{p.email_normalized}</p><p>{formatPhone(p.phone_normalized)}</p>
                <ActionForm action={linkApplicationAction} submitLabel="Link to this person" variant="secondary" className="mt-2">
                  <input type="hidden" name="application_id" value={a.id} /><input type="hidden" name="person_id" value={p.id} />
                </ActionForm>
              </div>
            ))}
          </div>
          {a.duplicate_candidates.some((d) => d.kind === "application") ? <p className="mt-2 text-xs text-ink-muted">Also matches {a.duplicate_candidates.filter((d) => d.kind === "application").length} other application(s).</p> : null}
        </Card>
      ) : null}

      <Card title="Their answers">
        <dl>
          <Row k="Email" v={a.email_normalized} />
          <Row k="Phone" v={formatPhone(a.phone_normalized)} />
          <Row k="Prefers" v={a.contact_preference.replace("_", " ")} />
          <Row k="Connection" v={labelFor(CONNECTIONS, a.existing_club_connection)} />
          <Row k="Heard via" v={labelFor(HEARD_FROM, a.heard_from)} />
          <Row k="Interests" v={[a.unsure_role ? "Not sure — help me find a role" : null, ...a.interests.map(interestLabel)].filter(Boolean).join(", ")} />
          <Row k="Roles chosen" v={a.selected_position_ids.map(title).join(", ")} />
          <Row k="Strengths" v={a.strengths.map((s) => labelFor(STRENGTHS, s)).join(", ")} />
          <Row k="Experience" v={a.experience_text} />
          <Row k="Learn / shadow" v={a.willing_to_learn} />
          <Row k="Time" v={[labelFor(COMMITMENT_BUCKETS, a.commitment_bucket), labelFor(COMMITMENT_PATTERNS, a.commitment_pattern)].filter(Boolean).join(" · ")} />
          <Row k="Usually free" v={[a.availability_varies ? "Varies" : null, slots].filter(Boolean).join("; ")} />
          <Row k="Where" v={labelFor(LOCATION_PREFS, a.work_location_preference)} />
          <Row k="Anything else" v={a.free_notes} />
          <Row k="Club news" v={a.communication_opt_in ? "Yes, opted in" : "No"} />
          <Row k="Privacy notice" v={`Acknowledged (version ${a.privacy_notice_version})`} />
        </dl>
      </Card>

      <Card title="Suggested roles">
        <p className="mb-2 text-xs text-ink-muted">Suggestions only, from simple rules. They never accept, reject or appoint anyone.</p>
        {suggestions.length === 0 ? <p className="text-sm">No clear matches. Talk to them about what they&apos;d enjoy.</p> : (
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.club_position_id} className="rounded-lg border border-line p-3">
                <p className="font-semibold">{title(s.club_position_id)} {s.needs_checks ? <Badge tone="warn">Needs club/FA checks</Badge> : null}</p>
                <ul className="list-disc pl-5 text-sm">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                <ActionForm action={matchPositionAction} submitLabel="Note interest in this role" variant="secondary" className="mt-2">
                  <input type="hidden" name="application_id" value={a.id} /><input type="hidden" name="position_id" value={s.club_position_id} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Review">
        <ActionForm action={updateApplicationAction} submitLabel="Save" trackChanges>
          <input type="hidden" name="application_id" value={a.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stage"><Select name="stage" defaultValue={a.stage}>{STAGES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</Select></Field>
            <Field label="Follow up on"><Input name="follow_up_on" type="date" defaultValue={a.follow_up_on ?? ""} /></Field>
          </div>
          <Checkbox name="contacted_now" label="I've contacted them today" hint={a.last_contacted_at ? `Last contacted ${formatLongDay(new Date(a.last_contacted_at))}` : undefined} />
          {a.duplicate_review_status === "possible_duplicate" ? <Checkbox name="not_duplicate" label="Not the same person (clear the duplicate flag)" /> : null}
          <Field label="Notes (administrators only)"><Textarea name="admin_notes" maxLength={2000} defaultValue={a.admin_notes ?? ""} /></Field>
        </ActionForm>
      </Card>

      {!a.linked_person_id ? (
        <Card title="Add to the directory">
          <p className="mb-2 text-sm">Creates a directory record with their contact details and preferences. It sends nothing and doesn&apos;t invite them; you can invite them to the Hub separately from their record.</p>
          <ActionForm action={createPersonFromApplicationAction} submitLabel="Add to directory" variant="secondary">
            <input type="hidden" name="application_id" value={a.id} />
            <Checkbox name="routine" label="Include in suggested availability recipients" />
          </ActionForm>
          <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-club">…or link to someone already in the directory</summary>
            <ActionForm action={linkApplicationAction} submitLabel="Link" variant="secondary">
              <input type="hidden" name="application_id" value={a.id} />
              <Field label="Person"><Select name="person_id" required defaultValue=""><option value="" disabled>Choose</option>{picker.map((p) => <option key={p.person_id} value={p.person_id}>{p.name}</option>)}</Select></Field>
            </ActionForm>
          </details>
        </Card>
      ) : (
        <Notice tone="info">To give them Hub access, open <Link className="font-semibold underline" href={`/manage/people/${a.linked_person_id}`}>their directory record</Link> and use “Send portal invitation”. That&apos;s always a separate, deliberate step.</Notice>
      )}

      <details className="rounded-xl border border-line bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-danger">Delete this application</summary>
        <p className="text-sm">Permanently removes their answers (for example, when they ask, or under the club&apos;s retention policy). A note that an application was deleted stays in the audit log, without any of their details.</p>
        <ActionForm action={deleteApplicationAction} submitLabel="Delete permanently" variant="danger" confirm="Delete this application permanently?">
          <input type="hidden" name="application_id" value={a.id} />
        </ActionForm>
      </details>
    </section>
  );
}
