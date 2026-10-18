import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { isPublicPath } from "@/lib/auth/paths";
import { legacyRedirect, legacyRotaEnabled } from "@/lib/legacy";

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out
 * visitors of protected pages to /login.
 *
 * This is an OPTIMISTIC check only (fast redirect). Real authorisation happens on the
 * server in every protected page and action via src/lib/auth/dal.ts, and in the database via RLS.
 */
export async function updateSession(request: NextRequest) {
  // Retired rota screens go to their Hub equivalents unless the legacy flag is on.
  if (!legacyRotaEnabled()) {
    const to = legacyRedirect(request.nextUrl.pathname);
    if (to) {
      const url = request.nextUrl.clone();
      url.pathname = to;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  let response = NextResponse.next({ request });
  const { supabaseUrl, supabaseKey } = publicEnv();

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it validates and refreshes the token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    // Remember the page they asked for so sign-in can return them there (validated on use).
    const wanted = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = "/login";
    url.search = "";
    if (request.nextUrl.pathname !== "/" && wanted.length <= 300) url.searchParams.set("next", wanted);
    const redirect = NextResponse.redirect(url);
    // Keep any refreshed/cleared auth cookies on the redirect.
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }

  // Return the response that setAll last built so refreshed cookies reach the browser.
  return response;
}
