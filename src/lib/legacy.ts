/**
 * The pre-Hub rota screens (template-driven shifts, approvals, coverage) are retired from normal
 * use. They stay in the code base, reachable only when LEGACY_ROTA_UI=true, so the change is
 * reversible without a redeploy of old code. Their data is kept, read-only in practice.
 */
export function legacyRotaEnabled(): boolean {
  return process.env.LEGACY_ROTA_UI === "true";
}

/** Old URL → Hub equivalent (event ids are preserved, so event links still work). */
export function legacyRedirect(pathname: string): string | null {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^\/rota\/([0-9a-f-]{36})$/i, (m) => `/calendar/${m[1]}`],
    [/^\/rota\/?$/, () => "/calendar"],
    [/^\/my-duties(\/.*)?$/, () => "/home"],
    [/^\/profile\/?$/, () => "/my-profile"],
    [/^\/manage\/calendar\/?$/, () => "/manage/events"],
    [/^\/manage\/coverage(\/.*)?$/, () => "/manage/venue-cover"],
    [/^\/manage\/approvals\/?$/, () => "/manage/requests"],
    [/^\/manage\/shifts(\/.*)?$/, () => "/manage/events"],
    [/^\/manage\/templates(\/.*)?$/, () => "/manage/settings"],
    [/^\/manage\/volunteers\/?$/, () => "/manage/people"],
  ];
  for (const [re, to] of rules) {
    const m = re.exec(pathname);
    if (m) return to(m);
  }
  return null;
}
