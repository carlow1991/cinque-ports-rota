import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/env";
import { log } from "@/lib/log";
import { PRIVACY_NOTICE_VERSION } from "@/lib/privacy";
import { serviceClient } from "@/lib/supabase/service";
import { SUBMIT_ERRORS, validateApplication } from "@/lib/domain/application-form";

/**
 * Public, no-login submission of a volunteer application.
 *  - Same-origin only (CSRF), JSON only, body size capped.
 *  - Anti-spam: hidden honeypot field and a minimum fill time — bots get the same generic success
 *    reply as people, and nothing is saved. Rate limits are enforced in the database by a hashed key.
 *  - Writes through ONE database function with the server-only secret key. Never reads anything
 *    back, and never says whether someone is already known to the club.
 *  - Never logs the applicant's answers.
 */
const OK = () => NextResponse.json({ ok: true }, { status: 200 });
const NO = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = new Set([new URL(siteUrl()).origin, request.nextUrl.origin]);
  if (!origin || !allowed.has(origin)) return NO("Please use the form on the club's website.", 403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return NO("Unsupported request.", 415);
  const text = await request.text();
  if (text.length > 20_000) return NO("That's too much text. Please shorten your answers.", 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return NO("Unsupported request."); }

  // Honeypot and minimum time to fill in three steps: quietly drop automated submissions.
  if (typeof body.website === "string" && body.website.trim() !== "") return OK();
  const started = Number(body.form_started_at);
  if (!Number.isFinite(started) || Date.now() - started < 3000) return OK();

  const v = validateApplication(body);
  if (!v.ok) return NO(v.error);
  const sb = serviceClient();
  if (!sb) { log.warn("apply", "secret key not configured"); return NO("Sorry, we can't take applications online right now. Please contact the club.", 503); }

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  const rateKey = createHash("sha256").update(`${process.env.SUPABASE_SECRET_KEY}:apply:${ip}`).digest("hex");
  const { error } = await sb.rpc("public_submit_application", {
    p: { ...v.data, privacy_notice_version: PRIVACY_NOTICE_VERSION },
    p_rate_key: rateKey,
  });
  if (error) {
    const code = error.message ?? "";
    if (code in SUBMIT_ERRORS) return NO(SUBMIT_ERRORS[code], code === "rate_limited" ? 429 : 400);
    if (error.code === "P0001" && error.details) return NO(error.details);
    log.warn("apply", "submission failed", { code: error.code }); // category only, never the content
    return NO("Sorry, something went wrong. Please try again in a few minutes.", 500);
  }
  return OK();
}

export function GET() {
  return NO("Not found.", 404);
}
