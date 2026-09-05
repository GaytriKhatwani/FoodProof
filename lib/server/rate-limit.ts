import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "./env";
import { notImplementedInT0 } from "./errors";

/**
 * Invitation-attempt limiter (FOODPROOF_TECHNICAL_SPEC.md §2, §4).
 * At most five failed attempts per 15-minute window, keyed by a keyed HMAC of
 * the originating address. The counter lives in `demo_access_attempts` with a
 * UNIQUE(address_hmac, window_started_at) constraint and is incremented
 * atomically (upsert/transaction/DB function) — implemented by T1. The raw
 * address is never stored; `address_hmac` is short-lived pseudonymous security
 * metadata, never used for analytics or profiling.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const WINDOW_SECONDS = 15 * 60;

/** Deterministic keyed hash of the originating address. Pure; no persistence. */
export function hashAddress(address: string): string {
  const { RATE_LIMIT_HMAC_KEY } = getServerEnv();
  return createHmac("sha256", RATE_LIMIT_HMAC_KEY).update(address).digest("hex");
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface InvitationRateLimiter {
  /** Atomically record a failed attempt and report whether the caller is now blocked. */
  recordFailedAttempt(addressHmac: string): Promise<RateLimitResult>;
  /** A successful entry may clear the current counter. */
  clear(addressHmac: string): Promise<void>;
}

export const t0InvitationRateLimiter: InvitationRateLimiter = {
  recordFailedAttempt: () =>
    notImplementedInT0("InvitationRateLimiter.recordFailedAttempt"),
  clear: () => notImplementedInT0("InvitationRateLimiter.clear"),
};
