import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  decideAccess,
  homePathFor,
  type AccessDecision,
  type AppRole,
  type VolunteerRecord,
} from "@/lib/auth/access";

/**
 * Data Access Layer for identity. Every protected page, Server Action and Route Handler
 * calls one of these. Results are deliberately NOT cached: a suspension or role change
 * must take effect on the very next request.
 */

/** Verify the session (JWT signature/expiry via getClaims) and load the caller's own volunteer row through RLS. */
export async function resolveAccess(allowedRoles?: readonly AppRole[]): Promise<AccessDecision> {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const authUserId = !error && claimsData?.claims?.sub ? String(claimsData.claims.sub) : null;
  if (!authUserId) return decideAccess(null, null, allowedRoles);

  // RLS returns this row only if it belongs to the caller AND is active.
  const { data } = await supabase
    .from("volunteers")
    .select("id, display_name, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  const volunteer: VolunteerRecord | null = data
    ? { id: data.id, displayName: data.display_name, role: data.role as AppRole, isActive: data.is_active }
    : null;

  return decideAccess(authUserId, volunteer, allowedRoles);
}

function enforce(decision: AccessDecision): VolunteerRecord {
  switch (decision.kind) {
    case "allow":
      return decision.volunteer;
    case "signed_out":
      redirect("/login");
    case "no_access":
      redirect("/no-access");
    case "forbidden":
      // Signed-in, active, but wrong role: send them to a page they can use.
      redirect("/rota");
  }
}

/** Any active, linked volunteer (admin, coordinator or volunteer). */
export async function requireVolunteer(): Promise<VolunteerRecord> {
  return enforce(await resolveAccess());
}

/** Active volunteer holding one of the given roles. */
export async function requireRole(roles: readonly AppRole[]): Promise<VolunteerRecord> {
  return enforce(await resolveAccess(roles));
}

export { homePathFor };
