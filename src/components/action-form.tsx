"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/result";
import { Button, FormMessage } from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";

type ServerAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * A form bound to a Server Action, with a pending state and an accessible result message.
 * Success is shown only after the server confirms the change was saved.
 */
export function ActionForm({
  action, submitLabel, pendingLabel = "Saving…", variant = "primary", children, className = "space-y-3", confirm, submitAriaLabel, trackChanges = false,
}: {
  action: ServerAction; submitLabel: string; pendingLabel?: string; variant?: "primary" | "secondary" | "danger";
  children?: ReactNode; className?: string; confirm?: string;
  /** Fuller accessible name for repeated buttons, e.g. "Take this duty: Pitch setup, Saturday 31 October". */
  submitAriaLabel?: string;
  /** Show "Unsaved changes" once edited and warn before leaving the page with them unsaved. */
  trackChanges?: boolean;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const ready = useHydrated();
  const [dirty, setDirty] = useState(false);
  // A successful save clears the flag (render-time adjustment, keyed on the result object).
  const [seen, setSeen] = useState(result);
  if (result !== seen) { setSeen(result); if (result?.ok) setDirty(false); }
  useEffect(() => {
    if (!trackChanges || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [trackChanges, dirty]);
  return (
    <form
      action={formAction}
      className={className}
      onChange={trackChanges ? () => setDirty(true) : undefined}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending || !ready} aria-label={pending ? undefined : submitAriaLabel}>{pending ? pendingLabel : submitLabel}</Button>
        {trackChanges && dirty && !pending ? <span role="status" className="text-sm font-semibold text-amber-800">Unsaved changes</span> : null}
        <FormMessage result={result} />
      </div>
    </form>
  );
}
