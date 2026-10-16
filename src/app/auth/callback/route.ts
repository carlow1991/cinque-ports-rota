import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { homePathFor, linkAllowsEntry } from "@/lib/auth/access";
import { resolveAccess } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/paths";

const ALLOWED_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "invite", "signup"];

/**
 * Completes sign-in from an emailed link (admin invite or sign-in link), then links the
 * Auth user to the pre-created volunteer row by VERIFIED email only. Any failure signs
 * the user out and returns them to /login with a non-revealing message.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "");

  const supabase = await createClient();

  let verified = false;
  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    verified = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  }
  if (!verified) {
    return NextResponse.redirect(`${origin}/login?error=link`, { status: 303 });
  }

  const { data: linkResult, error: linkError } = await supabase.rpc("link_volunteer_account");
  if (linkError || !linkAllowsEntry(linkResult as string)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=access`, { status: 303 });
  }

  const access = await resolveAccess();
  if (access.kind !== "allow") {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=access`, { status: 303 });
  }

  return NextResponse.redirect(`${origin}${next || homePathFor(access.volunteer.role)}`, { status: 303 });
}
