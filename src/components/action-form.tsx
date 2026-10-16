"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/actions/result";
import { Button, FormMessage } from "@/components/ui";
import { useHydrated } from "@/lib/use-hydrated";

type ServerAction = (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;

/**
 * A form bound to a Server Action, with a pending state and an accessible result message.
 * Success is shown only after the server confirms the change was saved.
 */
export function ActionForm({
  action, submitLabel, pendingLabel = "Saving…", variant = "primary", children, className = "space-y-3", confirm,
}: {
  action: ServerAction; submitLabel: string; pendingLabel?: string; variant?: "primary" | "secondary" | "danger";
  children?: ReactNode; className?: string; confirm?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const ready = useHydrated();
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending || !ready}>{pending ? pendingLabel : submitLabel}</Button>
        <FormMessage result={result} />
      </div>
    </form>
  );
}
