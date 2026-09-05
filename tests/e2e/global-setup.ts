/**
 * Playwright global setup: load `.env.local` into `process.env` so the e2e
 * helpers (which build a Supabase client directly) can reach the demo
 * project, the same way `next dev` does. Never logs or prints any value.
 */
export default function globalSetup(): void {
  try {
    // Node 20.6+ / 22+: reads KEY=VALUE lines into process.env, ignoring ones
    // already set. Not available on older Node — degrade silently so CI
    // without the file (or an older Node) still runs the specs that don't
    // need live credentials.
    process.loadEnvFile(".env.local");
  } catch {
    // Missing file or unsupported Node API: helpers report the missing
    // variable by name and skip rather than failing the whole run.
  }
}
