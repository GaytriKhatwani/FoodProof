import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { describe } from "vitest";

/**
 * Live integration-test helpers. Suites that need the demo Supabase project use
 * `liveDescribe`, which self-skips when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are absent (fresh clone, CI) so `npm run test` still passes without secrets.
 */

export const hasLiveSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const liveDescribe = hasLiveSupabase ? describe : describe.skip;

/** Optional anon key enables the real direct-client (RLS) denial assertion. */
export const anonKey = process.env.SUPABASE_ANON_KEY ?? "";

export function testClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function anonClient(): SupabaseClient | null {
  if (!anonKey) return null;
  return createClient(process.env.SUPABASE_URL as string, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const sha256Hex = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const newCode = () => randomBytes(24).toString("base64url");
export const randomAddressHmac = () => randomBytes(16).toString("hex");

/** A minimal, valid-enough PNG (correct signature + chunk framing) for uploads. */
export function samplePng(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[]) => {
    const len = data.length;
    const b = [(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
    for (const c of type) b.push(c.charCodeAt(0));
    b.push(...data, 0, 0, 0, 0);
    return b;
  };
  return Uint8Array.from([
    ...sig,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk("IDAT", [0x78, 0x9c, 0x62, 0, 0, 0, 2, 0, 1]),
    ...chunk("IEND", []),
  ]);
}

/** Remove any storage objects created under a set of report id prefixes. */
export async function cleanupStorage(client: SupabaseClient, reportIds: string[]) {
  for (const bucket of ["demo-originals", "demo-reviewed"]) {
    for (const reportId of reportIds) {
      const { data } = await client.storage.from(bucket).list(reportId);
      if (data && data.length) {
        await client.storage.from(bucket).remove(data.map((o) => `${reportId}/${o.name}`));
      }
    }
  }
}

export interface CreatedAccess {
  accessId: string;
  code: string;
}

/** Insert a demo_access row with a known raw code; returns the raw code. */
export async function createAccess(
  client: SupabaseClient,
  opts: {
    role: "user" | "reviewer";
    label: string;
    expiresAt?: string | null;
    revokedAt?: string | null;
  },
): Promise<CreatedAccess> {
  const code = newCode();
  const { data, error } = await client
    .from("demo_access")
    .insert({
      token_hash: sha256Hex(code),
      role: opts.role,
      label: opts.label,
      expires_at: opts.expiresAt ?? null,
      revoked_at: opts.revokedAt ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { accessId: data.id as string, code };
}

/** Remove demo_access rows (sessions/reports/receipts cascade) created by a test. */
export async function deleteAccess(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return;
  await client.from("demo_access").delete().in("id", ids);
}

/** Remove limiter rows for the given address HMACs. */
export async function deleteAttempts(client: SupabaseClient, hmacs: string[]) {
  if (hmacs.length === 0) return;
  await client.from("demo_access_attempts").delete().in("address_hmac", hmacs);
}
