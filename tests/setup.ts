// Vitest setup — load the gitignored .env.local (if present) so integration
// tests can reach the demo Supabase project. Contract/unit tests do not need
// it; integration suites self-skip when live credentials are absent.
try {
  // Node 20.12+/22+ builtin; no dependency.
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (CI, fresh clone): integration tests will skip themselves.
}
