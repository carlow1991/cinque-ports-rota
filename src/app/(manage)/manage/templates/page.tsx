import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageLoading } from "@/components/app-header";
import { Badge, Card, EVENT_TYPE_LABEL, Notice } from "@/components/ui";
import { MANAGER_ROLES } from "@/lib/auth/access";
import { requireRole } from "@/lib/auth/dal";
import { loadTemplates, loadVenues } from "@/lib/data/manage";
import { describeOffset } from "@/lib/domain/templates";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Templates />
    </Suspense>
  );
}

async function Templates() {
  const me = await requireRole(MANAGER_ROLES);
  const [templates, venues] = await Promise.all([loadTemplates({ includeInactive: true }), loadVenues()]);
  const venueName = (id: string | null) => (id ? venues.find((v) => v.id === id)?.name ?? "?" : "Either venue");

  return (
    <section aria-labelledby="tpl-heading" className="space-y-4">
      <h1 id="tpl-heading" className="text-2xl font-bold text-club">Templates</h1>
      <Notice tone="info">
        Staffing numbers are <strong>suggested defaults</strong>, not FA, statutory or grounds-safety minimums. Organisers adjust them per
        event. Managers, coaches, first-aiders, match officials and safeguarding cover are arranged separately and are not part of these templates.
      </Notice>
      {templates.map((t) => {
        const core = t.items.filter((i) => i.enabledByDefault);
        return (
          <Card key={t.id}
            title={<>{t.code}: {t.name} {!t.active ? <Badge tone="bad">Inactive</Badge> : null}</>}
            actions={me.role === "admin" ? <Link className="text-sm font-semibold text-club-blue underline" href={`/manage/templates/${t.id}`}>Edit</Link> : null}>
            <p className="text-sm text-ink-muted">{EVENT_TYPE_LABEL[t.event_type]} · {venueName(t.venue_id)} · default {core.length} row(s), {core.reduce((n, i) => n + i.requiredCount, 0)} place(s)</p>
            {t.description ? <p className="mt-1 text-sm">{t.description}</p> : null}
            <ul className="mt-2 divide-y divide-line text-sm">
              {t.items.map((i) => (
                <li key={i.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>
                    <strong>{i.dutyName}</strong> × {i.requiredCount}
                    {!i.enabledByDefault ? <span className="ml-1 text-ink-muted">(optional, off by default)</span> : null}
                    {i.responsibilities.length ? <span className="block text-xs text-ink-muted">Includes {i.responsibilities.map((r) => r.name).join(", ")}</span> : null}
                    {i.suppressedByLinkedCover ? <span className="block text-xs text-ink-muted">Not created when linked to venue-wide cover</span> : null}
                  </span>
                  <span className="text-ink-muted">{describeOffset(i.startAnchor, i.startOffsetMinutes)} → {describeOffset(i.endAnchor, i.endOffsetMinutes)}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </section>
  );
}
