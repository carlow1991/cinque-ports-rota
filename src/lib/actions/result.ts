/**
 * Shared Server Action result shape and error translation.
 * The database raises stable codes (message) with a human sentence (details); we show the
 * sentence, falling back to a friendly message per code. Raw database errors are never shown.
 */
export type ActionResult = { ok: true; message?: string; data?: Record<string, unknown> } | { ok: false; error: string };

export const initialResult: ActionResult | null = null;

const FRIENDLY: Record<string, string> = {
  not_authorised: "You don't have permission to do that.",
  not_found: "That item could not be found. It may have been changed by someone else.",
  invalid_times: "Check the times: the end must be after the start.",
  invalid_headcount: "Each duty needs between 1 and 50 volunteers.",
  publish_blocked: "This event can't be published yet.",
  coverage_link_other_venue: "Venue cover must be at the same venue.",
  coverage_link_not_coverage: "Choose a venue-wide cover event.",
  coverage_link_from_coverage: "A venue-cover event can't link to another one.",
  coverage_event_has_dependents: "Other events rely on this venue cover.",
  template_wrong_venue: "That template is for the other venue.",
  below_committed: "More volunteers are already committed than that number.",
  invalid_transition: "That change isn't possible in the event's current state.",
  reason_required: "Please give a reason.",
  title_required: "Give the event a title.",
  responsibility_is_primary: "An included duty can't repeat the main duty.",
  shift_outside_event_window: "Duty times must be within 24 hours of the event.",
};

type DbError = { message?: string; details?: string | null; code?: string } | null | undefined;

export function friendlyError(err: DbError, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const code = err.message ?? "";
  if (err.code === "P0001" || code in FRIENDLY) {
    const detail = typeof err.details === "string" && err.details && err.details !== code ? err.details : undefined;
    return detail ?? FRIENDLY[code] ?? fallback;
  }
  if (err.code === "42501") return FRIENDLY.not_authorised; // insufficient privilege / RLS
  if (err.code === "23505") return "That already exists.";
  if (err.code === "23514") return "Some details aren't valid. Check the form and try again.";
  return fallback;
}

export function fail(error: string): ActionResult {
  return { ok: false, error };
}

/** First zod issue as a sentence. */
export function firstIssue(issues: { message: string }[]): string {
  return issues[0]?.message ?? "Check the form and try again.";
}
