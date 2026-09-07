import type { DemoRole } from "@/lib/contracts";

/**
 * Shared post-entry helpers (docs/FOODPROOF_SCREENS.md §2). Both entry paths —
 * invitation (`EntryForm`) and email sign-in (`EmailSignInForm`, phase two
 * C.1) — land the same three response fields and then run the identical
 * analytics-consent step and redirect, so the mapping and destination rules
 * live here once rather than twice.
 */

export function entryRole(role: DemoRole): "reporter" | "reviewer" {
  return role === "reviewer" ? "reviewer" : "reporter";
}

/** Only ever follow a `next` that stays inside the pilot section. */
export function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/pilot/") ? raw : null;
}

/** Where a session lands after entry: a safe requested destination, or the role's home. */
export function destinationFor(role: DemoRole, requestedNext: string | null): string {
  if (requestedNext) return requestedNext;
  return role === "reviewer" ? "/pilot/review" : "/pilot/feed";
}
