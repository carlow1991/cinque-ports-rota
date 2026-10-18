import { describe, expect, it } from "vitest";
import { decideHubAccess, hubHomePath, type HubMe } from "@/lib/auth/access";
import { legacyRedirect } from "@/lib/legacy";
import { formatPhone, normalizePhone } from "@/lib/domain/hub-tags";

const me = (level: "admin" | "coordinator" | "member", enabled = true): HubMe => ({ person_id: "p1", name: "Test", access_level: level, enabled });

describe("Hub access decisions", () => {
  it("signed out, no account and disabled accounts are refused", () => {
    expect(decideHubAccess(null, me("admin"))).toEqual({ kind: "signed_out" });
    expect(decideHubAccess("u1", null)).toEqual({ kind: "no_access" });
    expect(decideHubAccess("u1", me("admin", false))).toEqual({ kind: "no_access" });
  });
  it("level gates", () => {
    expect(decideHubAccess("u1", me("member"), ["admin", "coordinator"]).kind).toBe("forbidden");
    expect(decideHubAccess("u1", me("coordinator"), ["admin"]).kind).toBe("forbidden");
    expect(decideHubAccess("u1", me("coordinator"), ["admin", "coordinator"]).kind).toBe("allow");
  });
  it("rejects an unknown level even if the row says enabled", () => {
    expect(decideHubAccess("u1", { ...me("member")!, access_level: "superuser" as never }).kind).toBe("no_access");
  });
  it("organisers land on Manage, members on Home", () => {
    expect(hubHomePath("admin")).toBe("/manage");
    expect(hubHomePath("coordinator")).toBe("/manage");
    expect(hubHomePath("member")).toBe("/home");
  });
});

describe("phone normalisation (mirrors public._hub_normalize_phone)", () => {
  it.each([
    ["07700 900123", "+447700900123"],
    ["+44 7700 900123", "+447700900123"],
    ["447700900123", "+447700900123"],
    ["(01304) 123456", "+441304123456"],
    ["", null],
    ["  ", null],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));
  it("formats UK numbers for display", () => {
    expect(formatPhone("+447700900123")).toBe("07700 900123");
    expect(formatPhone("+33123456789")).toBe("+33123456789");
  });
});

describe("legacy rota URLs", () => {
  it("map to their Hub equivalents, keeping event ids", () => {
    expect(legacyRedirect("/rota/2f1c0c34-9ef5-4c63-8fd5-9f4a0e1d2b3c")).toBe("/calendar/2f1c0c34-9ef5-4c63-8fd5-9f4a0e1d2b3c");
    expect(legacyRedirect("/rota")).toBe("/calendar");
    expect(legacyRedirect("/my-duties")).toBe("/home");
    expect(legacyRedirect("/profile")).toBe("/my-profile");
    expect(legacyRedirect("/manage/templates/abc")).toBe("/manage/settings");
    expect(legacyRedirect("/manage/volunteers")).toBe("/manage/people");
  });
  it("leave Hub URLs alone", () => {
    for (const p of ["/home", "/calendar", "/manage", "/manage/people", "/manage/events/new", "/my-profile"]) expect(legacyRedirect(p)).toBeNull();
  });
});
