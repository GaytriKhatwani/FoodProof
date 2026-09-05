// Operator seed script (FOODPROOF_TECHNICAL_SPEC.md §5a, decision D25).
//
// Creates the fictional published pilot example and its simulated response by
// driving the SAME application API/publication services a real reporter uses —
// never raw inserts that bypass invariants. It bootstraps a dedicated seed
// reporter + reviewer (demo_access), then over HTTP: creates the report, uploads
// label evidence, confirms facts, requests publication, approves it as reviewer,
// records a simulated brand response, and publishes + approves that response.
// It also leaves a second, unreported fictional product as an unpublished draft.
//
// Idempotent: if the seed example is already published, it exits without change.
// Requires the app running at APP_ORIGIN.
//
// Usage:
//   npm run dev              # in one terminal
//   node --env-file=.env.local scripts/seed.mjs
//   node --env-file=.env.local scripts/seed.mjs --reset   # replace the seeded example first

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";

const APP_ORIGIN = process.env.APP_ORIGIN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!APP_ORIGIN || !SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing APP_ORIGIN / SUPABASE_URL / SUPABASE_SECRET_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const sha256Hex = (v) => createHash("sha256").update(v).digest("hex");
const newCode = () => randomBytes(24).toString("base64url");
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const SEED_USER_LABEL = "seed@foodproof";
const SEED_REVIEWER_LABEL = "seed-reviewer@foodproof";
const SEED_LABELS = [SEED_USER_LABEL, SEED_REVIEWER_LABEL];

// Repo root, regardless of the cwd the script is invoked from.
const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");
// Fictional label photograph (design/assets), compressed copy: well under the
// 3 MB evidence cap and light enough for a 360px phone. Always fictional/
// illustrative — never evidence against a real brand (docs/FOODPROOF_PROTOTYPE_TO_BUILD.md).
const FICTIONAL_LABEL_PATH = nodePath.join(REPO_ROOT, "design", "assets", "clear-signal-label-preview.jpg");

const STORAGE_BUCKETS = ["demo-originals", "demo-reviewed"];

/**
 * Remove ONLY the rows owned by demo_access rows labelled exactly
 * `seed@foodproof` or `seed-reviewer@foodproof` (and everything under them),
 * plus their Storage objects in both private buckets — same child->parent
 * order as `deleteAccess` in tests/helpers/live.ts. Never touches any other
 * access row: the only selector is an exact label match.
 */
async function resetSeed() {
  const { data: access, error: accessErr } = await supabase
    .from("demo_access")
    .select("id")
    .in("label", SEED_LABELS);
  if (accessErr) throw new Error(`--reset: read demo_access failed: ${accessErr.message}`);
  const ids = (access ?? []).map((a) => a.id);
  if (ids.length === 0) {
    console.log("--reset: no seed access rows found. Nothing to remove.");
    return;
  }

  const { data: reports } = await supabase.from("reports").select("id").in("owner_access_id", ids);
  const reportIds = (reports ?? []).map((r) => r.id);

  let revIds = [];
  if (reportIds.length) {
    const { data: revs } = await supabase
      .from("publication_revisions")
      .select("id")
      .in("report_id", reportIds);
    revIds = (revs ?? []).map((r) => r.id);
  }

  const counts = {};
  const del = async (table, col, values) => {
    if (!values.length) {
      counts[table] = 0;
      return;
    }
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .in(col, values);
    if (error) throw new Error(`--reset: delete ${table} failed: ${error.message}`);
    counts[table] = count ?? 0;
  };

  let storageRemoved = 0;
  for (const bucket of STORAGE_BUCKETS) {
    for (const reportId of reportIds) {
      const { data: objects } = await supabase.storage.from(bucket).list(reportId);
      if (objects && objects.length) {
        const { error } = await supabase.storage
          .from(bucket)
          .remove(objects.map((o) => `${reportId}/${o.name}`));
        if (error) throw new Error(`--reset: remove storage ${bucket} failed: ${error.message}`);
        storageRemoved += objects.length;
      }
    }
  }

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

  console.log("--reset: removed the previously seeded example (counts only, never ids/codes):");
  console.log(`  demo_access:            ${counts.demo_access}`);
  console.log(`  reports:                ${counts.reports}`);
  console.log(`  evidence:               ${counts.evidence}`);
  console.log(`  publication_revisions:  ${counts.publication_revisions}`);
  console.log(`  publications:           ${counts.publications}`);
  console.log(`  publication_assets:     ${counts.publication_assets}`);
  console.log(`  content_flags:          ${counts.content_flags}`);
  console.log(`  report_events:          ${counts.report_events}`);
  console.log(`  updates:                ${counts.updates}`);
  console.log(`  submissions:            ${counts.submissions}`);
  console.log(`  complaint_drafts:       ${counts.complaint_drafts}`);
  console.log(`  operation_receipts:     ${counts.operation_receipts}`);
  console.log(`  demo_sessions:          ${counts.demo_sessions}`);
  console.log(`  storage objects (both buckets): ${storageRemoved}`);
}

async function alreadySeeded() {
  const { data: access } = await supabase
    .from("demo_access")
    .select("id")
    .eq("label", SEED_USER_LABEL);
  const ids = (access ?? []).map((a) => a.id);
  if (ids.length === 0) return false;
  const { data: reports } = await supabase.from("reports").select("id").in("owner_access_id", ids);
  const reportIds = (reports ?? []).map((r) => r.id);
  if (reportIds.length === 0) return false;
  const { data: pubs } = await supabase
    .from("publications")
    .select("report_id")
    .in("report_id", reportIds)
    .eq("visible", true);
  return (pubs ?? []).length > 0;
}

async function issueCode(role, label) {
  const code = newCode();
  const { error } = await supabase.from("demo_access").insert({
    token_hash: sha256Hex(code),
    role,
    label,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (error) throw new Error(`issue ${role}: ${error.message}`);
  return code;
}

function extractCookie(setCookie) {
  for (const c of setCookie ?? []) {
    if (c.startsWith("fp_session=")) return c.split(";")[0];
  }
  return null;
}

async function call(method, path, { cookie, body, form, expectOk = true } = {}) {
  const headers = { Origin: APP_ORIGIN };
  if (cookie) headers.Cookie = cookie;
  if (method !== "GET") headers["Idempotency-Key"] = randomUUID();
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(APP_ORIGIN + path, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  if (expectOk && (!json || json.error)) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json?.error ?? json)}`);
  }
  return { json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function login(code) {
  const { setCookie } = await call("POST", "/api/demo/session", { body: { invitation_code: code } });
  const cookie = extractCookie(setCookie);
  if (!cookie) throw new Error("no session cookie returned");
  return cookie;
}

async function uploadLabel(cookie, reportId) {
  const bytes = await readFile(FICTIONAL_LABEL_PATH);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), "fictional-label.jpg");
  form.append("kind", "label");
  form.append("roles", JSON.stringify(["identity", "claim", "ingredients"]));
  const { json } = await call("POST", `/api/reports/${reportId}/evidence`, { cookie, form });
  return json.data.id;
}

async function version(cookie, reportId) {
  const { json } = await call("GET", `/api/reports/${reportId}`, { cookie });
  return json.data.version;
}

async function main() {
  // Preflight: app reachable.
  await call("GET", "/api/health").catch(() => {
    throw new Error(`Cannot reach the app at ${APP_ORIGIN}. Start it with "npm run dev".`);
  });

  if (process.argv.includes("--reset")) {
    await resetSeed();
  } else if (await alreadySeeded()) {
    console.log("Seed example already published. Nothing to do. (Use --reset to replace it.)");
    return;
  }

  const userCode = await issueCode("user", SEED_USER_LABEL);
  const reviewerCode = await issueCode("reviewer", SEED_REVIEWER_LABEL);
  const user = await login(userCode);
  const reviewer = await login(reviewerCode);

  // 1) Published fictional concern.
  const { json: created } = await call("POST", "/api/reports", {
    cookie: user,
    body: {
      product_name: "Millet Cookies (sample)",
      brand: "Testbrand Foods (fictional)",
      variant: null,
      concern_text:
        "SAMPLE: the front label reads gluten-free, but the ingredients list wheat flour.",
      expected_version: null,
    },
  });
  const reportId = created.data.report_id;

  const evidenceId = await uploadLabel(user, reportId);
  await call("POST", `/api/reports/${reportId}/confirm-facts`, {
    cookie: user,
    body: {
      expected_version: await version(user, reportId),
      claim_text: "Gluten-free (front of pack)",
      ingredients_text: "Wheat flour, millet flour, sugar, salt",
      method: "manual",
    },
  });

  const { json: pubReq } = await call("POST", `/api/reports/${reportId}/publication-requests`, {
    cookie: user,
    body: {
      expected_version: await version(user, reportId),
      consent: true,
      selected_evidence_ids: [evidenceId],
    },
  });
  await call("POST", `/api/review/${pubReq.data.publication_revision_id}/decision`, {
    cookie: reviewer,
    body: { expected_version: 0, action: "approve" },
  });

  // 2) Simulated brand response, published and approved.
  const { json: submission } = await call("POST", `/api/reports/${reportId}/submissions`, {
    cookie: user,
    body: {
      channel: "brand",
      recipient: "Testbrand Foods consumer care (sample)",
      submitted_at: daysAgo(10),
    },
  });
  const { json: update } = await call("POST", `/api/reports/${reportId}/updates`, {
    cookie: user,
    body: {
      submission_id: submission.data.id,
      kind: "response",
      sender: "Testbrand Foods (simulated)",
      occurred_at: daysAgo(3),
      summary: "SIMULATED: the brand acknowledges the labelling issue and is reviewing the pack.",
    },
  });
  const { json: respReq } = await call("POST", `/api/reports/${reportId}/publication-requests`, {
    cookie: user,
    body: {
      expected_version: await version(user, reportId),
      consent: true,
      selected_evidence_ids: [evidenceId],
      source_update_id: update.data.id,
    },
  });
  await call("POST", `/api/review/${respReq.data.publication_revision_id}/decision`, {
    cookie: reviewer,
    body: { expected_version: 0, action: "approve" },
  });

  // 3) Second, unreported fictional product left as an unpublished draft.
  await call("POST", "/api/reports", {
    cookie: user,
    body: {
      product_name: "Oat Bran Crackers (sample)",
      brand: "Sample Pantry (fictional)",
      variant: "Classic",
      concern_text: "SAMPLE: unreported practice product for the pilot's second task.",
      expected_version: null,
    },
  });

  console.log("Seeded: 1 published fictional concern + simulated response, and 1 unpublished draft.");
  console.log(`Published report id: ${reportId}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
