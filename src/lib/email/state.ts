/**
 * One place that decides what the app may SAY about email. A queued message is not a delivered
 * one: wording must match whether sending is off, limited to approved addresses, or fully on.
 * Server-only in practice (reads process.env); pure so it can be unit-tested with a fake env.
 */
import { emailConfig } from "./worker";

export type MessagingState =
  | "off"            // EMAIL_SENDING_ENABLED is not "true": messages are queued, nothing is sent
  | "misconfigured"  // switched on but a required setting is missing: nothing is sent
  | "limited"        // on, but APP_ENV is not production: only allow-listed addresses get mail
  | "on";            // on in production: volunteers receive their emails

export function messagingState(env: Record<string, string | undefined> = process.env): MessagingState {
  const cfg = emailConfig(env);
  if (!cfg.enabled) return "off";
  if (cfg.problems.length) return "misconfigured";
  return cfg.production ? "on" : "limited";
}

/**
 * Sentence for a result message after a change that queues email to `who`
 * (e.g. "the volunteer", "3 volunteers"). `plural` picks has/have.
 */
export function notifyOutcome(state: MessagingState, who: string, plural = false): string {
  switch (state) {
    case "on": return `An email to ${who} is on its way.`;
    case "limited": return `An email to ${who} is queued. In pilot mode only approved addresses receive email, so tell them yourself if needed.`;
    default: return `Email is switched off, so ${who} ${plural ? "have" : "has"} not been emailed. Tell them yourself.`;
  }
}

/** Clause for confirm prompts describing what WILL happen to people. */
export function notifyFuture(state: MessagingState, who: string): string {
  return state === "on" ? `${who} will be emailed`
    : state === "limited" ? `an email to ${who} will be queued (pilot mode: approved addresses only)`
    : `${who} will not be emailed while email is off, so tell them yourself`;
}

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
