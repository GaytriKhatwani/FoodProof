// Operator teardown script (FOODPROOF_SETUP_AND_OPERATIONS.md).
//
// Deletes demo database records and original/reviewed storage copies. DRY-RUN by
// default: it prints counts and changes nothing. To actually delete you must
// pass BOTH --confirm AND --project <ref> matching this project's ref (a guard
// so an unknown/wrong project is never wiped). Never run against production.
//
// Usage:
//   node --env-file=.env.local scripts/teardown.mjs                       # dry run
//   node --env-file=.env.local scripts/teardown.mjs --confirm --project <ref>

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};
const confirm = process.argv.includes("--confirm");
const projectArg = arg("project");
const projectRef = new URL(SUPABASE_URL).host.split(".")[0];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKETS = ["demo-originals", "demo-reviewed"];

// Child -> parent order: several FKs to demo_access/evidence use NO ACTION (no
// cascade), so a cascade-only delete fails. Delete every table in this order.
const ORDERED_TABLES = [
  ["publication_assets", "id"],
  ["publications", "report_id"],
  ["publication_revisions", "id"],
  ["content_flags", "id"],
  ["report_events", "id"],
  ["updates", "id"],
  ["submissions", "id"],
  ["complaint_drafts", "id"],
  ["evidence", "id"],
  ["operation_receipts", "id"],
  ["ai_spend_ledger", "id"],
  ["reports", "id"],
  ["demo_sessions", "id"],
  ["demo_access_attempts", "id"],
  ["demo_access", "id"],
  ["products", "id"],
];

async function countTable(table) {
  const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function listAllObjects(bucket) {
  const paths = [];
  const { data: top } = await supabase.storage.from(bucket).list("", { limit: 1000 });
  for (const entry of top ?? []) {
    if (entry.id === null) {
      // A folder (report id): list its files.
      const { data: files } = await supabase.storage.from(bucket).list(entry.name, { limit: 1000 });
      for (const f of files ?? []) paths.push(`${entry.name}/${f.name}`);
    } else {
      paths.push(entry.name);
    }
  }
  return paths;
}

/**
 * The auth accounts behind verified actors (migration 0006). Returns [] on a
 * pre-0006 project, where the column does not exist yet. These accounts must be
 * deleted AFTER `demo_access`: the foreign key is ON DELETE RESTRICT, so pilot
 * content is never silently destroyed by removing an account.
 */
async function listVerifiedAuthUsers() {
  const { data, error } = await supabase
    .from("demo_access")
    .select("auth_user_id")
    .not("auth_user_id", "is", null);
  if (error) {
    if (/does not exist|column|PGRST/i.test(`${error.code} ${error.message}`)) return [];
    throw new Error(`demo_access.auth_user_id: ${error.message}`);
  }
  return (data ?? []).map((r) => r.auth_user_id).filter(Boolean);
}

async function main() {
  // demo_access cascades sessions/reports/evidence/drafts/updates/publications/etc.
  const tables = ["demo_access", "products", "demo_access_attempts"];
  const counts = {};
  for (const t of tables) counts[t] = await countTable(t);
  const authUserIds = await listVerifiedAuthUsers();
  const cascade = {
    reports: await countTable("reports"),
    evidence: await countTable("evidence"),
    publications: await countTable("publications"),
  };
  const storage = {};
  for (const b of BUCKETS) storage[b] = (await listAllObjects(b)).length;

  console.log(`Project ref: ${projectRef}`);
  console.log("Would delete (database):");
  console.log(`  demo_access:          ${counts.demo_access}  (cascades reports=${cascade.reports}, evidence=${cascade.evidence}, publications=${cascade.publications}, ...)`);
  console.log(`  products:             ${counts.products}`);
  console.log(`  demo_access_attempts: ${counts.demo_access_attempts}`);
  console.log(`  auth accounts:        ${authUserIds.length}  (verified sign-ins; deleted after demo_access)`);
  console.log("Would delete (storage):");
  for (const b of BUCKETS) console.log(`  ${b}: ${storage[b]} object(s)`);

  if (!confirm || projectArg !== projectRef) {
    console.log("\nDRY RUN — nothing deleted.");
    if (confirm && projectArg !== projectRef) {
      console.log(`Refusing: --project "${projectArg ?? ""}" does not match this project ref "${projectRef}".`);
    } else {
      console.log(`To delete, re-run with:  --confirm --project ${projectRef}`);
    }
    return;
  }

  // Storage first (no cascade), then tables in child -> parent order.
  for (const b of BUCKETS) {
    const paths = await listAllObjects(b);
    if (paths.length) {
      const { error } = await supabase.storage.from(b).remove(paths);
      if (error) throw new Error(`remove ${b}: ${error.message}`);
    }
  }
  for (const [table, key] of ORDERED_TABLES) {
    const { error } = await supabase.from(table).delete().not(key, "is", null);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
  // Last: the auth accounts, now that no demo_access row references them.
  for (const id of authUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`delete auth user ${id}: ${error.message}`);
    }
  }
  console.log("\nDeleted demo records, verified accounts and storage copies.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
