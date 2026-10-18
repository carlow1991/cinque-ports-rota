"use client";

import { useState } from "react";
import { formatDuration } from "@/lib/domain/duty-time";
import { offsetFromParts, offsetToParts, sampleTimes, type Anchor } from "@/lib/domain/template-timing";

/**
 * Readable duty timing for the template editor: "45 minutes | before | the event starts", mapped to
 * the existing signed offsets (negative = before). Shows a live sample for a typical 15:00–16:45 event.
 */
export function TimingFields({ startAnchor, startOffset, endAnchor, endOffset, idPrefix }: {
  startAnchor: Anchor; startOffset: number; endAnchor: Anchor; endOffset: number; idPrefix: string;
}) {
  const [s, setS] = useState(() => ({ anchor: startAnchor, ...offsetToParts(startOffset) }));
  const [e, setE] = useState(() => ({ anchor: endAnchor, ...offsetToParts(endOffset) }));
  const sample = sampleTimes(s.anchor, offsetFromParts(s.minutes, s.dir), e.anchor, offsetFromParts(e.minutes, e.dir));

  return (
    <div className="space-y-2">
      {([["start", "Starts", s, setS], ["end", "Ends", e, setE]] as const).map(([k, label, v, set]) => (
        <fieldset key={k} className="space-y-1">
          <legend className="text-sm font-semibold">{label}</legend>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="number" name={`${k}_minutes`} min={0} max={1440} inputMode="numeric" value={v.minutes}
              aria-label={`${label}: minutes`} id={`${idPrefix}-${k}-min`}
              onChange={(ev) => set({ ...v, minutes: Math.max(0, Math.min(1440, Number(ev.target.value) || 0)) })}
              className="w-20 rounded-lg border border-line px-2 py-2 text-center" />
            <span>minutes</span>
            <select name={`${k}_dir`} value={v.dir} aria-label={`${label}: before or after`}
              onChange={(ev) => set({ ...v, dir: ev.target.value as "before" | "after" })}
              className="rounded-lg border border-line bg-white px-2 py-2">
              <option value="before">before</option><option value="after">after</option>
            </select>
            <select name={`${k}_anchor`} value={v.anchor} aria-label={`${label}: event start or end`}
              onChange={(ev) => set({ ...v, anchor: ev.target.value as Anchor })}
              className="rounded-lg border border-line bg-white px-2 py-2">
              <option value="event_start">the event starts</option><option value="event_end">the event ends</option>
            </select>
          </div>
        </fieldset>
      ))}
      <p aria-live="polite" className={`text-sm ${sample.ok ? "text-ink-muted" : "font-medium text-danger"}`}>
        {sample.ok
          ? <>Example: for an event 15:00–16:45 this duty runs <strong className="font-mono tabular-nums text-ink">{sample.text}</strong> ({formatDuration(new Date(0), new Date(sample.minutes * 60_000))}).</>
          : "This duty would end before it starts. Check the times."}
      </p>
    </div>
  );
}
