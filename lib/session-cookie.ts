/**
 * Session cookie name — the single source of truth shared by the server
 * session module (`lib/server/session.ts`) and the root `middleware.ts`.
 * Dependency-free (no `server-only`, no other project imports) so the Edge
 * middleware can import it without pulling in server-only code.
 */
export const SESSION_COOKIE = "fp_session";
