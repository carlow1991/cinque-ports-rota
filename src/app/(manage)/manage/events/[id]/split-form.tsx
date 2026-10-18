"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { splitPreview } from "@/lib/domain/cover-fit";
import { formatTime, londonToInstant } from "@/lib/time/london";
import { splitSiteLeadAction } from "../actions";

/** Guided handover: pick the time, see both parts and what each includes, then split (server re-checks). */
export function SplitForm({ shiftId, startsAt, endsAt, responsibilities, defaultDate, defaultTime }: {
  shiftId: string; startsAt: string; endsAt: string; responsibilities: { code: string; name: string }[];
  defaultDate: string; defaultTime: string;
}) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const at = londonToInstant(date, time);
  const start = Date.parse(startsAt), end = Date.parse(endsAt);
  const p = at.ok ? splitPreview(start, end, at.instant.getTime(), responsibilities) : { ok: false as const, error: "Enter a valid date and time." };
  const fmt = (ms: number) => formatTime(new Date(ms));

  return (
    <ActionForm action={splitSiteLeadAction} submitLabel="Split into two site-lead duties" variant="secondary" pendingLabel="Splitting…" className="mt-2 space-y-3"
      confirm="Split this site-lead duty into two handover duties? Both will need a confirmed lead.">
      <input type="hidden" name="shift_id" value={shiftId} />
      <p className="text-sm">One lead opens up and hands over; a second lead takes over and locks up. The two duties meet exactly, so there is no gap.</p>
      <div className="grid grid-cols-2 gap-2 sm:w-96">
        <Field label="Handover date"><Input type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <Field label="Handover time"><Input type="time" name="time" value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
      </div>
      <div aria-live="polite" className="text-sm">
        {p.ok ? (
          <ul className="space-y-1">
            <li><strong>First lead:</strong> <span className="font-mono tabular-nums">{fmt(p.first.start)}–{fmt(p.first.end)}</span>{p.first.includes.length ? ` · includes ${p.first.includes.join(", ").toLowerCase()}` : ""}</li>
            <li><strong>Second lead:</strong> <span className="font-mono tabular-nums">{fmt(p.second.start)}–{fmt(p.second.end)}</span>{p.second.includes.length ? ` · includes ${p.second.includes.join(", ").toLowerCase()}` : ""}</li>
            <li className="text-ink-muted">Each lead needs the club authorisations for their own part.</li>
          </ul>
        ) : <p role="alert" className="font-medium text-danger">{p.error}</p>}
      </div>
    </ActionForm>
  );
}
