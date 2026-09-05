// Operator script — create the private evidence buckets (FOODPROOF_TECHNICAL_SPEC.md §5).
//
// Creates `demo-originals` and `demo-reviewed` as PRIVATE buckets (no public
// access, no direct-client policy). Bytes are only ever served through the
// server's guarded media routes. Idempotent: existing buckets are left as-is.
//
// Usage:
//   node --env-file=.env.local scripts/setup-storage.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKETS = ["demo-originals", "demo-reviewed"];
const FILE_SIZE_LIMIT = 3 * 1024 * 1024; // 3 MB per file (spec §5/§6)

async function ensureBucket(name) {
  const { error } = await supabase.storage.createBucket(name, {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
  });
  if (!error) return `created ${name}`;
  if (/already exists/i.test(error.message)) return `exists  ${name}`;
  throw new Error(`createBucket(${name}) failed: ${error.message}`);
}

async function main() {
  for (const name of BUCKETS) {
    console.log(`  ${await ensureBucket(name)} (private)`);
  }
  console.log("Storage ready. Buckets are private; access only via guarded media routes.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
