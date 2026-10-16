/**
 * Public (browser-safe) configuration. Server-only secrets live in src/lib/env.server.ts.
 * NEXT_PUBLIC_* values must be referenced literally so Next.js can inline them.
 */
export function publicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.",
    );
  }
  return { supabaseUrl: url, supabaseKey: key };
}

/** Absolute site origin used to build auth redirect links. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
