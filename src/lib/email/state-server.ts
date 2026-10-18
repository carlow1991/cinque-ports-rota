import "server-only";
import { createClient } from "@/lib/supabase/server";
import { messagingState, type MessagingState } from "./state";

/**
 * The email state the app may describe: the hosting switches (env) AND the database release switch
 * (club_settings.email_released_from, set by an administrator in Settings). If the hosting switch is
 * on but email hasn't been started, nothing is sent, so the state is "paused". If the release can't
 * be read, assume paused rather than promise an email.
 */
export async function loadMessagingState(): Promise<MessagingState> {
  const env = messagingState();
  if (env !== "on" && env !== "limited") return env;
  const sb = await createClient();
  const r = await sb.from("club_settings").select("email_released_from").maybeSingle();
  if (r.error || !r.data) return "paused";
  return (r.data as { email_released_from: string | null }).email_released_from ? env : "paused";
}
