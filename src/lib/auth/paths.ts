/** Routes reachable without a session. Everything else requires sign-in. */
// "/api/cron/" skips the session check only: the route itself requires the CRON_SECRET bearer token.
// "/volunteer" (opportunities + application), "/privacy" and "/help" (how-to guide) are the public, no-login pages; "/api/public/"
// is the rate-limited application endpoint (it reads nothing back).
const PUBLIC_PREFIXES = ["/login", "/auth/", "/no-access", "/api/cron/", "/volunteer", "/privacy", "/help", "/api/public/"];

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

/**
 * Where to go after sign-in: the page they originally asked for when that is safe and useful,
 * otherwise their normal home. Never a public page (avoids /login loops), and never the organiser
 * area for a volunteer (that page would refuse them anyway).
 */
export function returnPathAfterLogin(next: string | null | undefined, home: string, isManager: boolean): string {
  const p = safeNextPath(next, "");
  if (!p || p === "/" || isPublicPath(p.split("?")[0])) return home;
  if (!isManager && (p === "/manage" || p.startsWith("/manage/") || p.startsWith("/manage?"))) return home;
  return p;
}
