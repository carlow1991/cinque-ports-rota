"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/actions/result";
import { Button, FormMessage } from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";

type Action = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * "Can you help?" — Yes / No, and if Yes: whole event or a time window. Two taps for the common case.
 * This is a reply, not a booking; the wording says so.
 */
export function HelpResponse({ action, eventId, current, currentText, endKnown }: {
  action: Action; eventId: string; current: "yes" | "no" | null; currentText?: string; endKnown: boolean;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const [choice, setChoice] = useState<"yes" | null>(null);
  const [part, setPart] = useState(false);
  const ready = useHydrated();
  return (
    <section aria-labelledby="can-help" className="rounded-xl border-2 border-club-blue/40 bg-white p-4">
      <h2 id="can-help" className="text-lg font-semibold text-club">Can you help?</h2>
      {current ? <p className="text-sm">Your answer: <strong>{currentText}</strong>. You can change it.</p> : null}
      {choice !== "yes" ? (
        <div className="mt-3 flex gap-3">
          <Button type="button" onClick={() => setChoice("yes")} disabled={!ready} className="flex-1">Yes</Button>
          <form action={formAction} className="flex-1">
            <input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="response" value="no" />
            <Button type="submit" variant="secondary" disabled={!ready || pending} className="w-full">{pending ? "Saving…" : "No"}</Button>
          </form>
        </div>
      ) : (
        <form action={formAction} className="mt-3 space-y-3">
          <input type="hidden" name="event_id" value={eventId} /><input type="hidden" name="response" value="yes" />
          <fieldset className="space-y-1">
            <legend className="text-sm font-semibold">When?</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="when" value="whole" defaultChecked onChange={() => setPart(false)} className="h-5 w-5" />
              <span>Whole event{endKnown ? "" : " (finish time not recorded yet)"}</span>
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" name="when" value="part" onChange={() => setPart(true)} className="h-5 w-5" />
              <span>Part of it</span>
            </label>
          </fieldset>
          {part ? (
            <div className="flex gap-3">
              <label className="block flex-1 space-y-1"><span className="text-sm font-semibold">From</span>
                <input name="from" type="time" required className="block w-full rounded-lg border border-line px-3 py-2" /></label>
              <label className="block flex-1 space-y-1"><span className="text-sm font-semibold">Until</span>
                <input name="until" type="time" required className="block w-full rounded-lg border border-line px-3 py-2" /></label>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Send my answer"}</Button>
            <Button type="button" variant="secondary" onClick={() => setChoice(null)}>Back</Button>
          </div>
        </form>
      )}
      <div className="mt-2"><FormMessage result={result} /></div>
      <p className="mt-2 text-xs text-ink-muted">Saying yes tells organisers you could help. You&apos;re only booked if they ask you and you accept.</p>
    </section>
  );
}
