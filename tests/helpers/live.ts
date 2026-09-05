import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { describe } from "vitest";

/**
 * Live integration-test helpers. Suites that need the demo Supabase project use
 * `liveDescribe`, which self-skips when SUPABASE_URL / SUPABASE_SECRET_KEY
 * are absent (fresh clone, CI) so `npm run test` still passes without secrets.
 *
 * Suites whose services call the migration-0003 functions use `liveSuite(...,
 * { requiresSchema3: true })` instead: without 0003 they report BLOCKED (skipped
 * with the reason in the suite name) rather than failing confusingly. A skipped
 * or blocked suite is never evidence that its assertions held.
 */

export const hasLiveSupabase = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

export const liveDescribe = hasLiveSupabase ? describe : describe.skip;

/**
 * TEST-ONLY publishable key (`sb_publishable_...`) — the key a browser would
 * hold. The application never reads it. Its presence enables the real
 * direct-client denial suite; its absence SKIPS that suite with a stated reason.
 */
export const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

export function testClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** A real direct client holding only the publishable key (no session). */
export function publishableClient(): SupabaseClient | null {
  if (!publishableKey) return null;
  return createClient(process.env.SUPABASE_URL as string, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cheap probe for `supabase/migrations/0003_transactional_operations.sql`:
 * `fp_schema_version()` returns 3 once it is applied. There is no CLI/psql on
 * the build machine, so 0003 is applied by the project owner in the Supabase SQL
 * Editor; until then the suites that depend on it must report BLOCKED.
 */
export async function schemaVersion(): Promise<number> {
  if (!hasLiveSupabase) return 0;
  const { data, error } = await testClient().rpc("fp_schema_version");
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

export interface SuiteGate {
  /** `describe` when the suite can run, `describe.skip` when it cannot. */
  run: (name: string, fn: () => void) => void;
  /** Suite name, carrying the skip/blocked reason when it does not run. */
  title: string;
  /** True only when the suite actually runs. */
  enabled: boolean;
}

/**
 * Resolve a live suite's gate. A gate that does not run states WHY in the suite
 * name (visible in the vitest summary) and warns once on stderr.
 */
export async function liveSuite(
  name: string,
  opts?: { requiresSchema3?: boolean },
): Promise<SuiteGate> {
  if (!hasLiveSupabase) {
    return {
      run: describe.skip,
      title: `${name} — SKIPPED: SUPABASE_URL / SUPABASE_SECRET_KEY not set`,
      enabled: false,
    };
  }
  if (opts?.requiresSchema3 && (await schemaVersion()) < 3) {
    console.warn(
      `[foodproof tests] BLOCKED: "${name}" needs supabase/migrations/0003_transactional_operations.sql, ` +
        "which is not applied to the demo project (fp_schema_version() is absent). " +
        "Apply 0003 in the Supabase SQL Editor and re-run.",
    );
    return {
      run: describe.skip,
      title: `${name} — BLOCKED: migration 0003_transactional_operations.sql not applied to the demo project`,
      enabled: false,
    };
  }
  return { run: describe, title: name, enabled: true };
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

/**
 * Remove all data created under a test's demo_access rows. Several FKs use
 * NO ACTION (publication_assets->evidence, report_events/publication_revisions/
 * content_flags -> demo_access), and Postgres's end-of-statement check is not
 * reliably satisfied by a single cascading delete here, so we delete every child
 * table explicitly in child->parent order, scoped to the test's reports/accesses.
 * Errors are surfaced so a leak is never silent.
 */
export async function deleteAccess(client: SupabaseClient, ids: string[]) {
  if (ids.length === 0) return;

  const { data: reports } = await client
    .from("reports")
    .select("id")
    .in("owner_access_id", ids);
  const reportIds = (reports ?? []).map((r) => r.id);

  let revIds: string[] = [];
  if (reportIds.length) {
    const { data: revs } = await client
      .from("publication_revisions")
      .select("id")
      .in("report_id", reportIds);
    revIds = (revs ?? []).map((r) => r.id);
  }

  const del = async (table: string, col: string, values: string[]) => {
    if (!values.length) return;
    const { error } = await client.from(table).delete().in(col, values);
    if (error) throw new Error(`cleanup ${table} failed: ${error.message}`);
  };

  await del("publication_assets", "revision_id", revIds);
  await del("publications", "report_id", reportIds);
  await del("publication_revisions", "report_id", reportIds);
  await del("content_flags", "report_id", reportIds);
  await del("report_events", "report_id", reportIds);
  await del("updates", "report_id", reportIds);
  await del("submissions", "report_id", reportIds);
  await del("complaint_drafts", "report_id", reportIds);
  await del("evidence", "report_id", reportIds);
  await del("operation_receipts", "actor_id", ids);
  await del("reports", "id", reportIds);
  await del("demo_sessions", "access_id", ids);
  await del("demo_access", "id", ids);
}

/** Remove limiter rows for the given address HMACs. */
export async function deleteAttempts(client: SupabaseClient, hmacs: string[]) {
  if (hmacs.length === 0) return;
  const { error } = await client
    .from("demo_access_attempts")
    .delete()
    .in("address_hmac", hmacs);
  if (error) throw new Error(`deleteAttempts failed: ${error.message}`);
}
