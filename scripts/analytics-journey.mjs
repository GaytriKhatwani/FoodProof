// Operator script — drive a consented journey and print the events it should
// produce, so the owner can compare them against Mixpanel Live View.
//
// There is no Mixpanel service account for the demo project, so ingestion
// read-back cannot be automated. This script produces the other half of that
// check: it exercises the real HTTP API (never raw inserts) and prints the
// expected event names IN ORDER with the exact `$insert_id` each one carries,
// plus the session's `analytics_actor_id` to filter Live View by. It then runs a
// DECLINED session and a WITHDRAWN-mid-way session, which must produce nothing.
//
// It creates its own temporary invitations and deletes everything it created.
// It never prints an invitation code, a session token, or any secret.
//
// Usage:
//   npm run dev              # in one terminal
//   node --env-file=.env.local scripts/analytics-journey.mjs

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const { APP_ORIGIN, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!APP_ORIGIN || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing APP_ORIGIN / SUPABASE_URL / SUPABASE_SECRET_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sha256Hex = (v) => createHash("sha256").update(v).digest("hex");
const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = nodePath.join(REPO_ROOT, "public", "illustrative-label.jpg");
const LABEL_TEXT = "ANALYTICS JOURNEY (temporary)";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The same derivation as `stableEventId` in lib/server/analytics.ts (which is
 * the source of truth): sha256 of `${idempotencyKey}:${eventName}`, formatted as
 * a v4-shaped UUID. Kept in step by hand because operator scripts are plain ESM.
 */
function stableEventId(key, eventName) {
  const h = sha256Hex(`${key}:${eventName}`);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `${variant}${h.slice(17, 20)}`, h.slice(20, 32)].join("-");
}

const created = { access: [], reports: [] };

async function invite(role) {
  const code = randomBytes(24).toString("base64url");
  const { data, error } = await supabase
    .from("demo_access")
    .insert({ token_hash: sha256Hex(code), role, label: LABEL_TEXT, expires_at: new Date(Date.now() + 3600_000).toISOString() })
    .select("id")
    .single();
  if (error) throw new Error(`invite: ${error.message}`);
  created.access.push(data.id);
  return code;
}

async function call(method, path, { cookie, body, form, flowId, key } = {}) {
  const headers = { Origin: APP_ORIGIN };
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET" && key) headers["Idempotency-Key"] = key;
  if (flowId) headers["X-Flow-Id"] = flowId;
  let payload = form;
  if (!form && body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(APP_ORIGIN + path, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  if (!json || json.error) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json?.error ?? json)}`);
  return { data: json.data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function enter(role) {
  const code = await invite(role);
  const { setCookie } = await call("POST", "/api/demo/session", { body: { invitation_code: code } });
  const cookie = (setCookie.find((c) => c.startsWith("fp_session=")) ?? "").split(";")[0];
  if (!cookie) throw new Error("no session cookie returned");
  return cookie;
}

const setConsent = (cookie, allowed) =>
  call("PUT", "/api/me/analytics-consent", { cookie, body: { allowed } });

/** The server-minted analytics actor id for this session (never a secret). */
async function actorId(cookie) {
  const token = cookie.slice("fp_session=".length);
  const { data } = await supabase
    .from("demo_sessions")
    .select("analytics_actor_id")
    .eq("token_hash", sha256Hex(token))
    .maybeSingle();
  return data?.analytics_actor_id ?? null;
}

const version = async (cookie, id) => (await call("GET", `/api/reports/${id}`, { cookie })).data.version;

/** Create → upload label → confirm facts → save draft → record submission → request publication. */
async function journey(cookie, { expectEvents }) {
  const emitted = [];
  const step = async (name, key, run) => {
    await run();
    if (expectEvents) emitted.push({ name, event_id: stableEventId(key, name) });
  };

  const flowId = randomUUID();
  let reportId;
  let evidenceId;

  const createKey = randomUUID();
  await step("report_saved", createKey, async () => {
    const { data } = await call("POST", "/api/reports", {
      cookie,
      key: createKey,
      flowId,
      body: {
        product_name: "Journey Crackers (sample)",
        brand: "Testbrand Foods (fictional)",
        concern_text: "SAMPLE: front label reads gluten-free, ingredients list wheat flour.",
        expected_version: null,
      },
    });
    reportId = data.report_id;
    created.reports.push(reportId);
  });

  const uploadKey = randomUUID();
  await step("evidence_uploaded", uploadKey, async () => {
    const form = new FormData();
    form.append("file", new Blob([await readFile(LABEL)], { type: "image/jpeg" }), "illustrative-label.jpg");
    form.append("kind", "label");
    form.append("roles", JSON.stringify(["identity", "claim", "ingredients"]));
    const { data } = await call("POST", `/api/reports/${reportId}/evidence`, { cookie, key: uploadKey, form });
    evidenceId = data.id;
  });

  const factsKey = randomUUID();
  await step("facts_confirmed", factsKey, async () =>
    call("POST", `/api/reports/${reportId}/confirm-facts`, {
      cookie,
      key: factsKey,
      body: {
        expected_version: await version(cookie, reportId),
        claim_text: "Gluten-free (front of pack)",
        ingredients_text: "Wheat flour, millet flour, sugar, salt",
        method: "manual",
      },
    }));

  const draftKey = randomUUID();
  await step("complaint_draft_saved", draftKey, async () => {
    const { data: prepared } = await call("POST", `/api/reports/${reportId}/prepare`, { cookie, body: { channel: "brand" } });
    await call("PUT", `/api/reports/${reportId}/complaint-drafts/brand`, {
      cookie,
      key: draftKey,
      body: { subject: prepared.subject, body: prepared.body, method: "template", expected_version: null },
    });
  });

  const submissionKey = randomUUID();
  await step("submission_recorded", submissionKey, () =>
    call("POST", `/api/reports/${reportId}/submissions`, {
      cookie,
      key: submissionKey,
      body: { channel: "brand", recipient: "Testbrand Foods consumer care (sample)", submitted_at: today() },
    }));

  const publishKey = randomUUID();
  await step("publication_requested", publishKey, async () =>
    call("POST", `/api/reports/${reportId}/publication-requests`, {
      cookie,
      key: publishKey,
      body: {
        expected_version: await version(cookie, reportId),
        consent: true,
        selected_evidence_ids: [evidenceId],
      },
    }));

  return emitted;
}

async function cleanup() {
  const ids = created.access;
  if (!ids.length) return;
  const { data: reports } = await supabase.from("reports").select("id").in("owner_access_id", ids);
  const reportIds = (reports ?? []).map((r) => r.id);
  let revIds = [];
  if (reportIds.length) {
    const { data: revs } = await supabase.from("publication_revisions").select("id").in("report_id", reportIds);
    revIds = (revs ?? []).map((r) => r.id);
  }
  for (const bucket of ["demo-originals", "demo-reviewed"]) {
    for (const reportId of reportIds) {
      const { data } = await supabase.storage.from(bucket).list(reportId);
      if (data?.length) await supabase.storage.from(bucket).remove(data.map((o) => `${reportId}/${o.name}`));
    }
  }
  const del = async (table, col, values) => {
    if (!values.length) return;
    const { error } = await supabase.from(table).delete().in(col, values);
    if (error) throw new Error(`cleanup ${table}: ${error.message}`);
  };
  // Child -> parent, the same order as deleteAccess in tests/e2e/helpers.ts.
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

async function main() {
  await call("GET", "/api/health").catch(() => {
    throw new Error(`Cannot reach the app at ${APP_ORIGIN}. Start it with "npm run dev".`);
  });

  console.log("\n=== 1. CONSENTED reporter journey — these events are expected in Mixpanel ===");
  const consented = await enter("user");
  await setConsent(consented, true);
  console.log(`analytics_actor_id: ${await actorId(consented)}   (filter Live View by this)`);
  const events = await journey(consented, { expectEvents: true });
  events.forEach((e, i) => console.log(`  ${i + 1}. ${e.name.padEnd(24)} $insert_id=${e.event_id}`));

  console.log("\n=== 2. DECLINED session — expected: no events at all from here on ===");
  const declined = await enter("user");
  await setConsent(declined, false);
  console.log(`analytics_actor_id: ${await actorId(declined)}   (null = nothing to attribute)`);
  await journey(declined, { expectEvents: false });
  console.log("  ran the same journey. expected: no events after this point.");

  console.log("\n=== 3. WITHDRAWN mid-way — events before the withdrawal only ===");
  const withdrawn = await enter("user");
  await setConsent(withdrawn, true);
  const beforeId = await actorId(withdrawn);
  const withdrawKey = randomUUID();
  const { data: report } = await call("POST", "/api/reports", {
    cookie: withdrawn,
    key: withdrawKey,
    flowId: randomUUID(),
    body: { product_name: "Withdraw Crackers (sample)", brand: "Testbrand Foods (fictional)", expected_version: null },
  });
  created.reports.push(report.report_id);
  console.log(`analytics_actor_id: ${beforeId}`);
  console.log(`  1. report_saved              $insert_id=${stableEventId(withdrawKey, "report_saved")}`);
  await setConsent(withdrawn, false);
  console.log("  consent withdrawn. expected: no events after this point.");
  const closeKey = randomUUID();
  await call("POST", `/api/reports/${report.report_id}/close`, {
    cookie: withdrawn,
    key: closeKey,
    body: { reason: "SAMPLE: journey script finished with this report." },
  });
  console.log("  (closed the report — report_closed must NOT appear)");
}

main()
  .then(() => cleanup())
  .then(() => console.log("\nTemporary invitations, sessions and reports deleted.\n"))
  .catch(async (e) => {
    console.error(`\n${e.message ?? e}`);
    await cleanup().catch((c) => console.error(`cleanup also failed: ${c.message ?? c}`));
    process.exit(1);
  });
