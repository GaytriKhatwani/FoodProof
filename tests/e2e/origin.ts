/**
 * Origin the browser specs run against. Derived from APP_ORIGIN in .env.local
 * (which the same-origin check in lib/server/context.ts also uses), so a
 * worktree started on another port (e.g. `npm run dev -- -p 3002` with
 * APP_ORIGIN=http://localhost:3002) tests its own server, never a neighbour's.
 * Override explicitly with E2E_ORIGIN. Playwright evaluates the config before
 * globalSetup runs, so the env file is loaded here as well.
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local (CI/fresh clone): fall back to the default origin.
}

export const E2E_ORIGIN: string =
  process.env.E2E_ORIGIN ?? process.env.APP_ORIGIN ?? "http://localhost:3000";

export const E2E_PORT: number = Number(new URL(E2E_ORIGIN).port || 3000);
