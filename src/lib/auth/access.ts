/**
 * Pure access decisions, kept free of Next.js and Supabase so they can be unit-tested exhaustively.
 * The database (RLS + SECURITY DEFINER helpers) enforces the same rules independently.
 */
export type AppRole = "admin" | "coordinator" | "volunteer";

export type VolunteerRecord = {
  id: string;
  displayName: string;
  role: AppRole;
  isActive: boolean;
};

export type AccessDecision =
  | { kind: "allow"; volunteer: VolunteerRecord }
  | { kind: "signed_out" } // no valid session → /login
  | { kind: "no_access" } // signed in but not an active, linked volunteer → /no-access
  | { kind: "forbidden" }; // active volunteer without the required role → their home page

export const MANAGER_ROLES: readonly AppRole[] = ["admin", "coordinator"];

export function decideAccess(
  authUserId: string | null,
  volunteer: VolunteerRecord | null,
  allowedRoles?: readonly AppRole[],
): AccessDecision {
  if (!authUserId) return { kind: "signed_out" };
  if (!volunteer || !volunteer.isActive) return { kind: "no_access" };
  if (allowedRoles && !allowedRoles.includes(volunteer.role)) return { kind: "forbidden" };
  return { kind: "allow", volunteer };
}

/** Where a signed-in volunteer lands by default. */
export function homePathFor(role: AppRole): string {
  return MANAGER_ROLES.includes(role) ? "/manage" : "/rota";
}

export type LinkResult = "linked" | "already_linked" | "not_invited" | "inactive" | "unverified" | "conflict";

export function linkAllowsEntry(result: string | null | undefined): boolean {
  return result === "linked" || result === "already_linked";
}

// ---------------------------------------------------------------------------
// Volunteer Hub: access is based on the PERSON and their portal account (user_accounts).
// ---------------------------------------------------------------------------
export type AccessLevel = "admin" | "coordinator" | "member";

export type HubPerson = { id: string; name: string; level: AccessLevel };

export type HubAccessDecision =
  | { kind: "allow"; person: HubPerson }
  | { kind: "signed_out" }
  | { kind: "no_access" }
  | { kind: "forbidden" };

export const HUB_MANAGERS: readonly AccessLevel[] = ["admin", "coordinator"];
export const HUB_ADMIN: readonly AccessLevel[] = ["admin"];

export type HubMe = { person_id: string; name: string; access_level: AccessLevel; enabled: boolean } | null;

export function decideHubAccess(authUserId: string | null, me: HubMe, allowed?: readonly AccessLevel[]): HubAccessDecision {
  if (!authUserId) return { kind: "signed_out" };
  if (!me || !me.enabled || !["admin", "coordinator", "member"].includes(me.access_level)) return { kind: "no_access" };
  if (allowed && !allowed.includes(me.access_level)) return { kind: "forbidden" };
  return { kind: "allow", person: { id: me.person_id, name: me.name, level: me.access_level } };
}

export const isHubManager = (level: AccessLevel) => HUB_MANAGERS.includes(level);

/** Where someone lands after signing in. */
export function hubHomePath(level: AccessLevel): string {
  return isHubManager(level) ? "/manage" : "/home";
}
