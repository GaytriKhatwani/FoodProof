import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "./env";
import { getServiceClient } from "./supabase";

/**
 * Invitation-attempt limiter (FOODPROOF_TECHNICAL_SPEC.md §2, §4).
 * At most five failed attempts per 15-minute window, keyed by a keyed HMAC of
 * the originating address. The counter lives in `demo_access_attempts`
 * (UNIQUE(address_hmac, window_started_at)) and is incremented atomically by the
 * `record_access_attempt()` database function. The raw address is never stored;
 * `address_hmac` is short-lived pseudonymous security metadata, never used for
 * analytics or profiling. Windows tumble on a fixed WINDOW_SECONDS boundary so
 * `window_started_at` is deterministic and the unique constraint coalesces
 * concurrent attempts. Persistent (Supabase-backed) so it holds across the
 * multi-instance Vercel deployment; in-memory throttling alone is insufficient.
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
  /** Read-only gate: is this address currently over the window limit? Never increments. */
  check(addressHmac: string): Promise<RateLimitResult>;
  /** Atomically record a failed attempt and report whether the caller is now blocked. */
  recordFailedAttempt(addressHmac: string): Promise<RateLimitResult>;
  /** A successful entry may clear the current counter. */
  clear(addressHmac: string): Promise<void>;
}

interface Window {
  startIso: string;
  expiresIso: string;
  retryAfterSeconds: number;
}

function currentWindow(): Window {
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;
  const startMs = Math.floor(now / windowMs) * windowMs;
  const expiresMs = startMs + windowMs;
  return {
    startIso: new Date(startMs).toISOString(),
    expiresIso: new Date(expiresMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresMs - now) / 1000)),
  };
}

export const invitationRateLimiter: InvitationRateLimiter = {
  async check(addressHmac) {
    const w = currentWindow();
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("demo_access_attempts")
      .select("attempt_count")
      .eq("address_hmac", addressHmac)
      .eq("window_started_at", w.startIso)
      .maybeSingle();
    if (error) throw error;
    const count = data?.attempt_count ?? 0;
    return {
      allowed: count < MAX_FAILED_ATTEMPTS,
      retryAfterSeconds: w.retryAfterSeconds,
    };
  },

  async recordFailedAttempt(addressHmac) {
    const w = currentWindow();
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("record_access_attempt", {
      p_address_hmac: addressHmac,
      p_window: w.startIso,
      p_expires: w.expiresIso,
    });
    if (error) throw error;
    const count = typeof data === "number" ? data : Number(data);
    // Opportunistic cleanup of expired rows (no scheduled job in this MVP).
    void supabase
      .from("demo_access_attempts")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .then(() => undefined, () => undefined);
    return {
      allowed: count <= MAX_FAILED_ATTEMPTS,
      retryAfterSeconds: w.retryAfterSeconds,
    };
  },

  async clear(addressHmac) {
    const w = currentWindow();
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("demo_access_attempts")
      .delete()
      .eq("address_hmac", addressHmac)
      .eq("window_started_at", w.startIso);
    if (error) throw error;
  },
};
