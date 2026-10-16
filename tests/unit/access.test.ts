import { describe, expect, it } from "vitest";
import { decideAccess, homePathFor, linkAllowsEntry, MANAGER_ROLES, type VolunteerRecord } from "@/lib/auth/access";
import { isPublicPath, safeNextPath } from "@/lib/auth/paths";

const vol = (over: Partial<VolunteerRecord> = {}): VolunteerRecord => ({
  id: "v1",
  displayName: "Sam",
  role: "volunteer",
  isActive: true,
  ...over,
});

describe("decideAccess", () => {
  it("signed out when there is no verified session", () => {
    expect(decideAccess(null, vol())).toEqual({ kind: "signed_out" });
  });
  it("no access for a signed-in Auth user with no volunteer row (uninvited)", () => {
    expect(decideAccess("uid", null)).toEqual({ kind: "no_access" });
  });
  it("no access for an inactive (suspended) volunteer, whatever their role", () => {
    for (const role of ["admin", "coordinator", "volunteer"] as const) {
      expect(decideAccess("uid", vol({ role, isActive: false }), MANAGER_ROLES)).toEqual({ kind: "no_access" });
      expect(decideAccess("uid", vol({ role, isActive: false }))).toEqual({ kind: "no_access" });
    }
  });
  it("volunteer may use volunteer pages but not organiser pages", () => {
    expect(decideAccess("uid", vol()).kind).toBe("allow");
    expect(decideAccess("uid", vol(), MANAGER_ROLES)).toEqual({ kind: "forbidden" });
  });
  it("admin and coordinator may use organiser pages", () => {
    expect(decideAccess("uid", vol({ role: "admin" }), MANAGER_ROLES).kind).toBe("allow");
    expect(decideAccess("uid", vol({ role: "coordinator" }), MANAGER_ROLES).kind).toBe("allow");
  });
  it("coordinator is refused admin-only pages", () => {
    expect(decideAccess("uid", vol({ role: "coordinator" }), ["admin"])).toEqual({ kind: "forbidden" });
  });
});

describe("homePathFor / linkAllowsEntry", () => {
  it("routes by role", () => {
    expect(homePathFor("volunteer")).toBe("/rota");
    expect(homePathFor("coordinator")).toBe("/manage");
    expect(homePathFor("admin")).toBe("/manage");
  });
  it("only linked/already_linked allow entry", () => {
    expect(linkAllowsEntry("linked")).toBe(true);
    expect(linkAllowsEntry("already_linked")).toBe(true);
    for (const r of ["not_invited", "inactive", "unverified", "conflict", "", null, undefined, "LINKED"]) {
      expect(linkAllowsEntry(r as string)).toBe(false);
    }
  });
});

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/rota", "/rota"],
    ["/rota/abc?x=1", "/rota/abc?x=1"],
  ])("keeps same-site path %s", (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", "rota", "/\nx"])(
    "rejects %j",
    (input) => {
      expect(safeNextPath(input, "/fallback")).toBe("/fallback");
    },
  );
});

describe("isPublicPath", () => {
  it("only login, auth and no-access are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/no-access")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/rota")).toBe(false);
    expect(isPublicPath("/manage")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/authx")).toBe(false);
  });
});
