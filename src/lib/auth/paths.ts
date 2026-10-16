/** Routes reachable without a session. Everything else requires sign-in. */
const PUBLIC_PREFIXES = ["/login", "/auth/", "/no-access"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/**
 * Accept only same-site relative paths for post-login redirects, preventing open redirects
 * such as "//evil.example", "https://evil.example" or "/\\evil.example".
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    return `${u.pathname}${u.search}`;
  } catch {
    return fallback;
  }
}
