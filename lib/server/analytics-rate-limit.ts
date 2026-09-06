import "server-only";
import { ApiError, MIGRATION_0005, mapRpcError } from "./errors";
import { getServiceClient } from "./supabase";

/**
 * Persistent, multi-instance-safe protection for `POST /api/analytics`
 * (FOODPROOF_TECHNICAL_SPEC.md §9, FOODPROOF_MEASUREMENT_AND_PILOT.md §2).
 *
 * The endpoint proxies client-owned events to the demo Mixpanel project. Without
 * a limit, one consented session could flood the project and corrupt the pilot
 * counts. This uses the SAME shape as the invitation-attempt limiter
 * (lib/server/rate-limit.ts): a tumbling fixed window and an atomic
 * create-or-increment (`record_analytics_event_attempt`, migration 0005) under a
 * UNIQUE(subject, window) constraint, so concurrent events on separate Vercel
 * instances coalesce correctly. In-memory throttling alone would not survive the
 * multi-instance deployment.
 *
 * The `subject` is an OPAQUE server-derived id (the session's access id): never a
 * raw IP address and never a value written to an analytics event. Timestamp
 * freshness is enforced separately by `assertFreshTimestamp`.
 */

/**
 * A normal consented pilot journey emits only a handful of client-owned events
 * per minute (see scripts/analytics-journey.mjs); 60 per rolling minute leaves
 * ample human headroom while stopping automated flooding.
 */
export const ANALYTICS_MAX_EVENTS = 60;
export const ANALYTICS_WINDOW_SECONDS = 60;

/**
 * `occurred_at` freshness window. A client event's timestamp is generated at the
 * moment of the action, so it should be within seconds of now. We tolerate two
 * minutes of clock skew into the future and reject anything older than 24 hours
 * as stale — well inside Mixpanel's own "5 days in the past" ceiling (see
 * lib/server/analytics.ts) and tight enough that a forged or replayed ancient
 * timestamp cannot corrupt the pilot's time series.
 */
export const ANALYTICS_FUTURE_SKEW_SECONDS = 120;
export const ANALYTICS_MAX_AGE_SECONDS = 24 * 60 * 60;

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface Window {
  startIso: string;
  expiresIso: string;
  retryAfterSeconds: number;
}

function currentWindow(seconds: number): Window {
  const now = Date.now();
  const windowMs = seconds * 1000;
  const startMs = Math.floor(now / windowMs) * windowMs;
  const expiresMs = startMs + windowMs;
  return {
    startIso: new Date(startMs).toISOString(),
    expiresIso: new Date(expiresMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresMs - now) / 1000)),
  };
}

export interface AnalyticsRateLimiter {
  /**
   * Atomically record one event attempt for the subject in the current window
   * and report whether the caller is now over the limit.
   */
  record(subject: string): Promise<RateDecision>;
}

export const analyticsRateLimiter: AnalyticsRateLimiter = {
  async record(subject) {
    const w = currentWindow(ANALYTICS_WINDOW_SECONDS);
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("record_analytics_event_attempt", {
      p_subject: subject,
      p_window: w.startIso,
      p_expires: w.expiresIso,
    });
    if (error) throw mapRpcError("record_analytics_event_attempt", error, MIGRATION_0005);
    const count = typeof data === "number" ? data : Number(data);
    // Opportunistic cleanup of expired rows (no scheduled job in this MVP).
    void supabase
      .from("analytics_event_attempts")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .then(() => undefined, () => undefined);
    return {
      allowed: count <= ANALYTICS_MAX_EVENTS,
      retryAfterSeconds: w.retryAfterSeconds,
    };
  },
};

/**
 * Reject a client `occurred_at` that is not a real timestamp, is too far in the
 * future, or is stale. Pure; `now` is injectable for tests. Throws
 * VALIDATION_FAILED (422) so a malformed event never reaches the sink.
 */
export function assertFreshTimestamp(occurredAt: string, now: number = Date.now()): void {
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) {
    throw new ApiError("VALIDATION_FAILED", "occurred_at is not a valid timestamp.");
  }
  if (t > now + ANALYTICS_FUTURE_SKEW_SECONDS * 1000) {
    throw new ApiError("VALIDATION_FAILED", "occurred_at is too far in the future.");
  }
  if (t < now - ANALYTICS_MAX_AGE_SECONDS * 1000) {
    throw new ApiError("VALIDATION_FAILED", "occurred_at is too far in the past.");
  }
}
