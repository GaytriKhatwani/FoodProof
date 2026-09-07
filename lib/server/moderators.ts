import "server-only";
import { z } from "zod";
import type { DemoRole } from "@/lib/contracts";
import { moderatorEmailsEnv } from "./env";
import { hashAddress } from "./rate-limit";

/**
 * Verified-account address handling and the reviewer allowlist
 * (FOODPROOF_TECHNICAL_SPEC.md §2 "Phase two C.1", docs/FOODPROOF_DECISIONS.md
 * D18).
 *
 * Two rules shape this module.
 *
 *  1. The address itself is stored only by the auth provider. Everything the
 *     application persists is `emailHmac()` — a keyed HMAC under the same secret
 *     that keys the invitation limiter, with a distinct purpose prefix so an
 *     address bucket and a destination bucket can never collide. It is
 *     pseudonymous operational metadata: never an analytics property, never a
 *     value returned to a browser, never reversible to the address.
 *  2. Authority comes from deployment configuration, never from a request. The
 *     reviewer role for a verified account is decided ONLY by `MODERATOR_EMAILS`
 *     — there is no role table and no role field a client can send. The set is
 *     compared as HMACs so no plaintext address is held longer than the call
 *     that normalises it.
 */

/** Shape validation only; case-folding is `normaliseEmail`'s job. */
const EmailShape = z.string().trim().min(3).max(254).email();

/**
 * Trim, validate and case-fold an address into the single form used for the
 * provider call, the HMAC and the allowlist comparison. One definition, so a
 * code requested for `A@B.test` is verifiable as `a@b.test` and vice versa.
 */
export function normaliseEmail(email: string): string {
  return EmailShape.parse(email).toLowerCase();
}

/** Same as `normaliseEmail`, but null for anything that is not an address. */
export function normaliseEmailOrNull(email: string | null | undefined): string | null {
  const parsed = EmailShape.safeParse(email ?? "");
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/**
 * Keyed HMAC of a normalised address. Reuses the invitation limiter's keyed
 * hash (one keyed-HMAC definition in the codebase) under an `email:` purpose
 * prefix, which no originating address can produce.
 */
export function emailHmac(email: string): string {
  return hashAddress(`email:${normaliseEmail(email)}`);
}

/** Distinct from every possible env value, including `undefined`. */
const UNBUILT = Symbol("moderator-allowlist-unbuilt");

let cachedSource: string | undefined | typeof UNBUILT = UNBUILT;
let cachedSet: Set<string> = new Set();

/**
 * The allowlist as HMACs, rebuilt only when `MODERATOR_EMAILS` itself changes.
 * An entry that is not a valid address is ignored rather than throwing: one
 * typo in the list must not take the whole deployment down, and ignoring it
 * fails CLOSED (that person simply is not a reviewer).
 */
function moderatorHmacs(): Set<string> {
  const source = moderatorEmailsEnv();
  if (source === cachedSource) return cachedSet;
  const next = new Set<string>();
  for (const entry of (source ?? "").split(",")) {
    const normalised = normaliseEmailOrNull(entry);
    if (normalised) next.add(hashAddress(`email:${normalised}`));
  }
  cachedSource = source;
  cachedSet = next;
  return next;
}

/** Is this verified account's address on the deployed reviewer allowlist? */
export function isModeratorEmailHmac(hmac: string | null): boolean {
  if (!hmac) return false;
  return moderatorHmacs().has(hmac);
}

/**
 * The role a verified actor should hold right now. Recomputed on every sign-in
 * AND on every request (lib/server/session.ts), so removing an address from
 * `MODERATOR_EMAILS` takes effect without a database migration or a manual edit.
 */
export function roleForEmailHmac(hmac: string | null): DemoRole {
  return isModeratorEmailHmac(hmac) ? "reviewer" : "user";
}

/** Test seam: drop the memoised allowlist after changing the environment. */
export function resetModeratorCache(): void {
  cachedSource = UNBUILT;
  cachedSet = new Set();
}
