import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "./env";

/**
 * Server-only Supabase service client (FOODPROOF_TECHNICAL_SPEC.md §3).
 * Built from the project's secret key (server-only; bypasses RLS), so every call
 * must still pass session, role, ownership and input checks in the data-access
 * modules above it. The browser never receives this key. Created lazily so the
 * homepage renders without it.
 */

let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;
  const env = getServerEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-foodproof-demo": "true" },
      // Next.js patches the global `fetch` in a route handler's runtime and,
      // by default, stores any GET response in its persistent Data Cache
      // (`.next/cache/fetch-cache`) — independent of the route's own
      // `export const dynamic = "force-dynamic"`, which only disables
      // ROUTE-level caching, not this inner fetch. supabase-js issues every
      // PostgREST read (and every Storage download) as a plain GET, so
      // without this override a service-client read could be served from
      // that cache indefinitely: a write lands in Postgres, but the next
      // read of the same URL replays the pre-write body forever (until the
      // cache entry happens to be evicted). That breaks read-your-writes for
      // things that must be effective on the very next request — analytics
      // consent, review approval showing up in the feed, and withdrawal
      // actually hiding a publication. Passing `cache: "no-store"` here opts
      // every service-client fetch out of the Data Cache, unconditionally,
      // at the one place all such reads go through.
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return client;
}
