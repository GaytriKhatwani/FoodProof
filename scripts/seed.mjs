// Operator seed script (FOODPROOF_TECHNICAL_SPEC.md §5a, decision D25).
//
// Creates the fictional pilot examples by driving the SAME application API and
// publication services a real reporter uses — never raw inserts that bypass
// invariants. It bootstraps a dedicated seed reporter + reviewer (demo_access),
// then over HTTP, for each fixture in SEED_CONCERNS: creates the report (linked
// to its product record), uploads label evidence, confirms facts, records the
// simulated submissions, requests the concern's publication (so its frozen
// external status correctly shows what was already reported), approves it as
// reviewer, records any simulated response and publishes + approves that
// revision, and closes the reporter's follow-up where the fixture says so.
//
// The ONE direct write is the `products` catalogue (dataset 'seed'): the app
// never creates product records itself, so the seed supplies the fictional
// products that "Look for an existing product" can match. Every report is
// linked to its record through the ordinary API (`product_id`).
//
// Three complete happy-path records, one unreported draft (SEED_CONCERNS).
// Idempotent: if a seed example is already published, it exits without change.
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
  await del("ai_spend_ledger", "access_id", ids);
  await del("reports", "id", reportIds);
  await del("demo_sessions", "access_id", ids);
  await del("demo_access", "id", ids);

  // Seed catalogue records, except any a non-seed report still links to
  // (reports.product_id is a plain FK; that report keeps its record).
  const { data: seedProducts } = await supabase.from("products").select("id").eq("dataset", "seed");
  const seedProductIds = (seedProducts ?? []).map((p) => p.id);
  let keptProducts = 0;
  if (seedProductIds.length) {
    const { data: stillLinked } = await supabase
      .from("reports")
      .select("product_id")
      .in("product_id", seedProductIds);
    const linked = new Set((stillLinked ?? []).map((r) => r.product_id));
    keptProducts = linked.size;
    await del("products", "id", seedProductIds.filter((id) => !linked.has(id)));
  } else {
    counts.products = 0;
  }

  console.log("--reset: removed the previously seeded examples (counts only, never ids/codes):");
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
  console.log(`  products (seed):        ${counts.products}${keptProducts ? ` (kept ${keptProducts} still linked from other reports)` : ""}`);
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


/**
 * Fictional catalogue + concerns (FOODPROOF_MEASUREMENT_AND_PILOT.md: every
 * product, brand, submission and response is sample material, never a real
 * company). Each published fixture exercises one shape of the happy path:
 *   1. brand submission + simulated brand response (follow-up still open)
 *   2. brand AND official submissions + brand response, follow-up closed
 *   3. published with no external submission yet
 * plus one unreported draft that stays private for the pilot's second task.
 */
const SEED_PRODUCTS = [
  { brand: "Testbrand Foods (fictional)", name: "Millet Cookies (sample)", variant: null },
  { brand: "Northfield Naturals (fictional)", name: "Ragi Choco Puffs (sample)", variant: "Family pack" },
  { brand: "Sample Pantry (fictional)", name: "Jowar Flakes (sample)", variant: "Honey" },
  { brand: "Sample Pantry (fictional)", name: "Oat Bran Crackers (sample)", variant: "Classic" },
];

const SEED_CONCERNS = [
  {
    product: SEED_PRODUCTS[0],
    concern_text: "SAMPLE: the front label reads gluten-free, but the ingredients list wheat flour.",
    observation_date: daysAgo(14),
    batch_number: "SAMPLE-B-2041",
    claim_text: "Gluten-free (front of pack)",
    ingredients_text: "Wheat flour, millet flour, sugar, salt",
    submissions: [{ channel: "brand", recipient: "Testbrand Foods consumer care (sample)", submitted_at: daysAgo(10) }],
    response: {
      to: "brand",
      sender: "Testbrand Foods (simulated)",
      occurred_at: daysAgo(3),
      summary: "SIMULATED: the brand acknowledges the labelling issue and is reviewing the pack.",
    },
    close: null,
    publish: true,
  },
  {
    product: SEED_PRODUCTS[1],
    concern_text:
      "SAMPLE: the pack carries a gluten-free badge, but the ingredient list names malt extract (barley) as a flavouring.",
    observation_date: daysAgo(30),
    batch_number: "SAMPLE-RC-0917",
    claim_text: "Gluten-free badge (front of pack, top right)",
    ingredients_text: "Ragi flour, rice flour, sugar, cocoa solids, malt extract (barley), salt",
    submissions: [
      { channel: "brand", recipient: "Northfield Naturals customer desk (sample)", submitted_at: daysAgo(26) },
      { channel: "government", recipient: "FoSCoS consumer grievance portal (sample)", submitted_at: daysAgo(24), reference: "SAMPLE-GRV-000123" },
    ],
    response: {
      to: "brand",
      sender: "Northfield Naturals (simulated)",
      occurred_at: daysAgo(12),
      summary: "SIMULATED: the brand says the badge was printed in error and the next run drops it.",
    },
    close: "SAMPLE: the brand confirmed a label correction on the next print run; nothing further to pursue.",
    publish: true,
  },
  {
    product: SEED_PRODUCTS[2],
    concern_text:
      "SAMPLE: 'gluten-free' appears in the product name, while the allergen line says 'may contain wheat' and the list includes wheat bran.",
    observation_date: daysAgo(5),
    batch_number: null,
    claim_text: "Gluten-free (part of the product name)",
    ingredients_text: "Jowar flakes, honey, sunflower oil, wheat bran, salt",
    submissions: [],
    response: null,
    close: null,
    publish: true,
  },
  {
    product: SEED_PRODUCTS[3],
    concern_text: "SAMPLE: unreported practice product for the pilot's second task.",
    observation_date: null,
    batch_number: null,
    claim_text: null,
    ingredients_text: null,
    submissions: [],
    response: null,
    close: null,
    publish: false,
  },
];

/** Same normalization as lib/server/products.ts and the SQL `norm()` index. */
const norm = (v) => (v ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Create or reuse the fictional product record for a fixture. Exact canonical
 * key only (the uniqueness index), display text preserved, dataset 'seed'.
 */
async function ensureProduct(product) {
  const { data: rows, error } = await supabase.from("products").select("id, brand, name, variant");
  if (error) throw new Error(`read products: ${error.message}`);
  const key = `${norm(product.brand)} ${norm(product.name)} ${norm(product.variant)}`;
  const found = (rows ?? []).find((r) => `${norm(r.brand)} ${norm(r.name)} ${norm(r.variant)}` === key);
  if (found) return found.id;
  const { data, error: insErr } = await supabase
    .from("products")
    .insert({ brand: product.brand, name: product.name, variant: product.variant, dataset: "seed" })
    .select("id")
    .single();
  if (insErr) throw new Error(`insert product ${product.name}: ${insErr.message}`);
  return data.id;
}

async function seedConcern(user, reviewer, fixture) {
  const productId = await ensureProduct(fixture.product);
  const { json: created } = await call("POST", "/api/reports", {
    cookie: user,
    body: {
      product_name: fixture.product.name,
      brand: fixture.product.brand,
      variant: fixture.product.variant,
      observation_date: fixture.observation_date,
      batch_number: fixture.batch_number,
      product_id: productId,
      concern_text: fixture.concern_text,
      expected_version: null,
    },
  });
  const reportId = created.data.report_id;
  if (!fixture.publish) return reportId;

  const evidenceId = await uploadLabel(user, reportId);
  await call("POST", `/api/reports/${reportId}/confirm-facts`, {
    cookie: user,
    body: {
      expected_version: await version(user, reportId),
      claim_text: fixture.claim_text,
      ingredients_text: fixture.ingredients_text,
      method: "manual",
    },
  });

  // Submissions are recorded BEFORE the publication request so the frozen
  // external status on the published concern reflects what was reported.
  const submissionIds = {};
  for (const sub of fixture.submissions) {
    const { json } = await call("POST", `/api/reports/${reportId}/submissions`, {
      cookie: user,
      body: { channel: sub.channel, recipient: sub.recipient, submitted_at: sub.submitted_at, reference: sub.reference },
    });
    submissionIds[sub.channel] = json.data.id;
  }

  const { json: pubReq } = await call("POST", `/api/reports/${reportId}/publication-requests`, {
    cookie: user,
    body: { expected_version: await version(user, reportId), consent: true, selected_evidence_ids: [evidenceId] },
  });
  await call("POST", `/api/review/${pubReq.data.publication_revision_id}/decision`, {
    cookie: reviewer,
    body: { expected_version: 0, action: "approve" },
  });

  // A response revision requires a visible published parent, so it follows
  // the approval; its publication never changes the concern's frozen status.
  if (fixture.response) {
    const { json: update } = await call("POST", `/api/reports/${reportId}/updates`, {
      cookie: user,
      body: {
        submission_id: submissionIds[fixture.response.to] ?? null,
        kind: "response",
        sender: fixture.response.sender,
        occurred_at: fixture.response.occurred_at,
        summary: fixture.response.summary,
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
  }

  if (fixture.close) {
    await call("POST", `/api/reports/${reportId}/close`, { cookie: user, body: { reason: fixture.close } });
  }
  return reportId;
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

  const published = [];
  let drafts = 0;
  for (const fixture of SEED_CONCERNS) {
    const reportId = await seedConcern(user, reviewer, fixture);
    if (fixture.publish) published.push(reportId);
    else drafts += 1;
    console.log(`  ${fixture.publish ? "published" : "draft    "}  ${fixture.product.brand} · ${fixture.product.name}`);
  }

  console.log(
    `Seeded: ${SEED_PRODUCTS.length} fictional product records, ${published.length} published fictional concerns, ${drafts} unpublished draft.`,
  );
  console.log(`Published report ids: ${published.join(", ")}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
