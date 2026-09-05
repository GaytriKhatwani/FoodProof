import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";

/**
 * Server-only Supabase service client (FOODPROOF_TECHNICAL_SPEC.md §3).
 * The service role bypasses RLS; every call must still pass session, role,
 * ownership and input checks in the data-access modules above it. The browser
 * never receives this key. Created lazily so the homepage renders without it.
 */

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;
  const env = getServerEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-foodproof-demo": "true" } },
  });
  return client;
}
