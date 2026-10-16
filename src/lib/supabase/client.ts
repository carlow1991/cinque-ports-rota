import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** Browser Supabase client. Uses only the publishable key; all data is guarded by RLS. */
export function createClient() {
  const { supabaseUrl, supabaseKey } = publicEnv();
  return createBrowserClient(supabaseUrl, supabaseKey);
}
