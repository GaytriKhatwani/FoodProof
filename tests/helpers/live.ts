import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { describe } from "vitest";

/**
 * Re-exported so existing suites (`import { samplePng } from "../helpers/live"`)
 * keep working unmodified; the generator itself lives in a vitest-free module
 * (`./sample-image`) so it can also be imported from Playwright specs.
 */
export { samplePng } from "./sample-image";

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
 * Cheap probe for the applied migration level: `fp_schema_version()` returns 3
 * after `0003_transactional_operations.sql` and 4 after
 * `0004_publication_atomicity_and_ai_spend.sql`. There is no CLI/psql on the
 * build machine, so migrations are applied by the project owner in the Supabase
 * SQL Editor; until then the suites that depend on them must report BLOCKED.
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
const MIGRATION_FILE: Record<number, string> = {
  3: "0003_transactional_operations.sql",
  4: "0004_publication_atomicity_and_ai_spend.sql",
};

export async function liveSuite(
  name: string,
  opts?: {
    /** Minimum `fp_schema_version()` the suite needs (3 or 4). */
    requiresSchema?: 3 | 4;
    /** Legacy alias for `requiresSchema: 3`. */
    requiresSchema3?: boolean;
  },
): Promise<SuiteGate> {
  if (!hasLiveSupabase) {
    return {
      run: describe.skip,
      title: `${name} — SKIPPED: SUPABASE_URL / SUPABASE_SECRET_KEY not set`,
      enabled: false,
    };
  }
  const required = opts?.requiresSchema ?? (opts?.requiresSchema3 ? 3 : 0);
  if (required > 0 && (await schemaVersion()) < required) {
    const file = MIGRATION_FILE[required] ?? `migration ${required}`;
    console.warn(
      `[foodproof tests] BLOCKED: "${name}" needs supabase/migrations/${file}, ` +
        "which is not applied to the demo project (fp_schema_version() is below it). " +
        `Apply ${file} in the Supabase SQL Editor and re-run.`,
    );
    return {
      run: describe.skip,
      title: `${name} — BLOCKED: migration ${file} not applied to the demo project`,
      enabled: false,
    };
  }
  return { run: describe, title: name, enabled: true };
}

export const sha256Hex = (v: string) =>
  createHash("sha256").update(v).digest("hex");
export const newCode = () => randomBytes(24).toString("base64url");
export const randomAddressHmac = () => randomBytes(16).toString("hex");

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
  // Migration 0004: cost/token rows only (cascade from demo_access; deleted
  // explicitly so a pre-0004 project and a post-0004 project clean up alike).
  await delIfPresent("ai_spend_ledger", "access_id", ids);
  await del("reports", "id", reportIds);
  await del("demo_sessions", "access_id", ids);
  await del("demo_access", "id", ids);

  async function delIfPresent(table: string, col: string, values: string[]) {
    if (!values.length) return;
    const { error } = await client.from(table).delete().in(col, values);
    // PGRST205 / 42P01: the table does not exist yet (migration not applied).
    if (error && !/does not exist|PGRST205|schema cache/i.test(`${error.code} ${error.message}`)) {
      throw new Error(`cleanup ${table} failed: ${error.message}`);
    }
  }
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
