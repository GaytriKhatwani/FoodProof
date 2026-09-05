// Operator script — generate demo invitation codes (FOODPROOF_TECHNICAL_SPEC.md §2).
//
// Creates high-entropy user/reviewer invitation codes and stores ONLY their
// SHA-256 hashes in demo_access. Raw codes are printed once to your terminal for
// private distribution; they are never written to a file, committed, or logged
// elsewhere. Do not paste raw codes into chat, Git, analytics, or query strings.
//
// Usage (loads the gitignored .env.local for SUPABASE_URL + the secret key):
//   node --env-file=.env.local scripts/create-invitations.mjs
//   node --env-file=.env.local scripts/create-invitations.mjs --users 3 --days 7
//   node --env-file=.env.local scripts/create-invitations.mjs --no-reviewer
//
// Each run creates NEW codes; it never prints or revokes existing ones.

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Run with --env-file=.env.local.");
  process.exit(1);
}

const userCount = Math.max(0, Number(arg("users", "2")) || 0);
const days = Math.max(1, Number(arg("days", "7")) || 7);
const includeReviewer = !hasFlag("no-reviewer");
const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sha256Hex = (v) => createHash("sha256").update(v).digest("hex");
const newCode = () => randomBytes(24).toString("base64url");

async function issue(role, label) {
  const code = newCode();
  const { error } = await supabase.from("demo_access").insert({
    token_hash: sha256Hex(code),
    role,
    label,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Insert failed for ${role}: ${error.message}`);
  return { role, label, code };
}

async function main() {
  const issued = [];
  for (let i = 0; i < userCount; i += 1) {
    issued.push(await issue("user", "user@foodproof"));
  }
  if (includeReviewer) issued.push(await issue("reviewer", "reviewer@foodproof"));

  console.log(`\nIssued ${issued.length} invitation code(s), expiring ${expiresAt}.`);
  console.log("Distribute privately. These are shown ONCE and are not stored anywhere in raw form.\n");
  for (const row of issued) {
    console.log(`  ${row.role.padEnd(8)} ${row.label.padEnd(20)} ${row.code}`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
