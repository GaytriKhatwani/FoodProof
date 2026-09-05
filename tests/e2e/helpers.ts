import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { test, type Page } from "@playwright/test";
import { E2E_ORIGIN } from "./origin";

/**
 * Invitation helpers for browser specs against the live demo Supabase
 * project. Deliberately duplicated (minimally) from tests/helpers/live.ts
 * rather than imported: that module imports `describe` from vitest at module
 * scope, so importing it here would pull vitest into the Playwright runner.
 * Keep the cleanup order in `deleteInvitations` in sync BY HAND with
 * `deleteAccess` in tests/helpers/live.ts if the schema/FKs change.
 */

const SUPABASE_URL_VAR = "SUPABASE_URL";

function secretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY;
}

/** Name of the first missing required env var, or null when both are present. */
function missingLiveCredential(): string | null {
  if (!process.env[SUPABASE_URL_VAR]) return SUPABASE_URL_VAR;
  if (!secretKey()) return "SUPABASE_SECRET_KEY";
  return null;
}

/**
 * Skip (never fail) the currently running test when live Supabase
 * credentials are absent, printing the missing variable name.
 */
function requireLive(): void {
  const missing = missingLiveCredential();
  if (missing) {
    // eslint-disable-next-line no-console
    console.warn(`[e2e] skipping: missing environment variable ${missing}`);
    test.skip(true, `Missing live credential: ${missing}`);
  }
}

function liveClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL as string, secretKey() as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
const newCode = () => randomBytes(24).toString("base64url");

export interface CreatedInvitation {
  accessId: string;
  code: string;
}

/** Insert a demo_access row with a known raw code (token_hash = sha256(code)). */
export async function createInvitation(
  role: "user" | "reviewer",
  label = `e2e ${role} ${Date.now()}`,
): Promise<CreatedInvitation> {
  requireLive();
  const code = newCode();
  const supabase = liveClient();
  const { data, error } = await supabase
    .from("demo_access")
    .insert({ token_hash: sha256Hex(code), role, label })
    .select("id")
    .single();
  if (error) throw new Error(`createInvitation failed: ${error.message}`);
  return { accessId: data.id as string, code };
}

/**
 * Remove demo_access rows and everything created under them, child->parent
 * (same order as `deleteAccess` in tests/helpers/live.ts).
 */
export async function deleteInvitations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = liveClient();

  const { data: reports } = await supabase
    .from("reports")
    .select("id")
    .in("owner_access_id", ids);
  const reportIds = (reports ?? []).map((r) => r.id as string);

  let revIds: string[] = [];
  if (reportIds.length) {
    const { data: revs } = await supabase
      .from("publication_revisions")
      .select("id")
      .in("report_id", reportIds);
    revIds = (revs ?? []).map((r) => r.id as string);
  }

  const del = async (table: string, col: string, values: string[]) => {
    if (!values.length) return;
    const { error } = await supabase.from(table).delete().in(col, values);
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

/**
 * Exchange an invitation code for a session cookie inside the browser
 * context: `page.request` shares its cookie jar with `page`, so a cookie set
 * by this response is present for subsequent `page.goto` navigation. The API
 * enforces same-origin, hence the explicit Origin header.
 *
 * TODO(T3): once the /pilot entry form ships, add an
 * `enterPilotViaForm(page, code)` that fills and submits the real form
 * instead of calling the API directly.
 */
export async function enterPilot(page: Page, code: string): Promise<void> {
  const res = await page.request.post("/api/demo/session", {
    headers: { Origin: E2E_ORIGIN },
    data: { invitation_code: code },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(`enterPilot failed (${res.status()}): ${body}`);
  }
}
