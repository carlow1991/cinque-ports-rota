"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { HUB_ADMIN } from "@/lib/auth/access";
import { requireLevel } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { authInvitesEnabled, sendAuthInvite } from "@/lib/supabase/admin";
import { fail, firstIssue, friendlyError, type ActionResult } from "@/lib/actions/result";
import { readPerson, readPreferences } from "@/lib/actions/hub-forms";
import { isDateKey } from "@/lib/time/london";

/**
 * People administration. Saving a person NEVER sends anything. Sending a portal invitation is a
 * separate, explicit action (or the explicit "Send portal invitation now" box on Add Person).
 */
const uuid = z.uuid();

export async function createPersonAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const parsed = readPerson(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const inviteNow = fd.get("send_invite_now") === "on";
  if (inviteNow && !parsed.data.email) return fail("Add an email address to send a portal invitation, or untick “Send portal invitation now”.");
  if (inviteNow && parsed.data.is_under_18) return fail("Under-18s aren't invited to the portal in this version.");
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_create_person", { p: parsed.data });
  if (error) return fail(friendlyError(error));
  const id = data as string;
  let note = "saved";
  if (inviteNow) {
    const r = await invite(id, "member");
    note = r.ok ? "invited" : "invite_failed";
  }
  redirect(`/manage/people/${id}?done=${note}`);
}

export async function updatePersonAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("person_id"));
  if (!id.success) return fail("Not found.");
  const parsed = readPerson(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { error } = await sb.rpc("hub_update_person", { p_person_id: id.data, p: parsed.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Saved. Nothing was sent." };
}

export async function setPreferencesAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("person_id"));
  if (!id.success) return fail("Not found.");
  const parsed = readPreferences(fd);
  if (!parsed.success) return fail(firstIssue(parsed.error.issues));
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_preferences", { p_person_id: id.data, p: parsed.data });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Interests and availability saved." };
}

/** Explicit portal invitation. Never reports success unless the Auth invitation really went. */
async function invite(personId: string, level: string): Promise<ActionResult> {
  const sb = await createClient();
  const { data, error } = await sb.rpc("hub_prepare_portal_invite", { p_person_id: personId, p_access_level: level });
  if (error) return fail(friendlyError(error));
  const r = data as { status: "ready" | "already_active" | "recently_sent"; email: string };
  if (r.status === "already_active") return { ok: true, message: "They already have portal access and can sign in." };
  if (r.status === "recently_sent") return { ok: true, message: "An invitation was sent a moment ago, so it wasn't sent again." };
  if (!authInvitesEnabled()) {
    await sb.rpc("hub_record_invite_result", { p_person_id: personId, p_state: "not_sent", p_error: "Invitation emails are switched off" });
    return fail("Invitation not sent — invitation emails are switched off for this site. Their access is ready; it can be sent once email is on.");
  }
  const sent = await sendAuthInvite(r.email);
  if (sent === "sent" || sent === "already_registered") {
    await sb.rpc("hub_record_invite_result", { p_person_id: personId, p_state: "sent" });
    return { ok: true, message: sent === "sent" ? `Invitation emailed to ${r.email}.` : "They're already registered and can sign in with their email." };
  }
  await sb.rpc("hub_record_invite_result", { p_person_id: personId, p_state: "failed", p_error: "Email provider did not accept the invitation" });
  return fail("Invitation not sent — the email couldn't be delivered. Try again later.");
}

export async function sendInviteAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("person_id"));
  const level = z.enum(["member", "coordinator", "admin"]).safeParse(fd.get("access_level") ?? "member");
  if (!id.success || !level.success) return fail("Not found.");
  const r = await invite(id.data, level.data);
  refresh();
  return r;
}

export async function setAccessAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const id = uuid.safeParse(fd.get("person_id"));
  const level = z.enum(["member", "coordinator", "admin"]).safeParse(fd.get("access_level"));
  if (!id.success || !level.success) return fail("Choose an access level.");
  const enabled = fd.get("enabled") === "on";
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_access", { p_person_id: id.data, p_access_level: level.data, p_enabled: enabled });
  if (error) return fail(friendlyError(error));
  const venues = fd.getAll("venue_ids").map(String).filter((x) => uuid.safeParse(x).success);
  const teams = fd.getAll("team_ids").map(String).filter((x) => uuid.safeParse(x).success);
  if (level.data === "coordinator" || venues.length || teams.length) {
    const s = await sb.rpc("hub_set_coordinator_scopes", { p_person_id: id.data, p_venue_ids: venues, p_team_ids: teams });
    if (s.error) return fail(friendlyError(s.error));
  }
  refresh();
  return { ok: true, message: enabled ? "Access saved." : "Access saved. They can no longer sign in." };
}

export async function setTeamRoleAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const personId = uuid.safeParse(fd.get("person_id"));
  const teamId = uuid.safeParse(fd.get("team_id"));
  const rowId = fd.get("team_role_id") ? uuid.safeParse(fd.get("team_role_id")) : null;
  if (!personId.success || !teamId.success || (rowId && !rowId.success)) return fail("Choose a team.");
  const label = String(fd.get("role_label") ?? "").trim();
  if (!label) return fail("Give the role a name, e.g. Manager.");
  const from = String(fd.get("active_from") ?? "").trim();
  const to = String(fd.get("active_to") ?? "").trim();
  if ((from && !isDateKey(from)) || (to && !isDateKey(to))) return fail("Enter dates as dd/mm/yyyy.");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_set_team_role", {
    p_id: rowId?.data ?? null, p_person_id: personId.data, p_team_id: teamId.data, p_role_label: label,
    p_expected: fd.get("is_expected_by_default") === "on", p_active_from: from || null, p_active_to: to || null,
  });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: "Team role saved." };
}

export async function createTeamAction(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  await requireLevel(HUB_ADMIN);
  const name = String(fd.get("name") ?? "").trim();
  if (!name || name.length > 80) return fail("Enter a team name (up to 80 characters).");
  const sb = await createClient();
  const { error } = await sb.rpc("hub_create_team", { p_name: name });
  if (error) return fail(friendlyError(error));
  refresh();
  return { ok: true, message: `${name} added.` };
}
