import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/server/errors";
import {
  ANALYTICS_FUTURE_SKEW_SECONDS,
  ANALYTICS_MAX_AGE_SECONDS,
  ANALYTICS_MAX_EVENTS,
  ANALYTICS_WINDOW_SECONDS,
  assertFreshTimestamp,
} from "@/lib/server/analytics-rate-limit";

/**
 * Pure timestamp-freshness validation for `POST /api/analytics` (risk #4). The
 * persistent limiter itself is exercised against the live database in
 * tests/integration/hardening.test.ts; these prove the window logic with no I/O.
 */

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const at = (deltaSeconds: number) => new Date(NOW + deltaSeconds * 1000).toISOString();

describe("analytics timestamp freshness", () => {
  it("accepts a current, real ISO timestamp", () => {
    expect(() => assertFreshTimestamp(at(0), NOW)).not.toThrow();
    expect(() => assertFreshTimestamp(at(-30), NOW)).not.toThrow();
  });

  it("accepts a timestamp inside the tolerated future skew", () => {
    expect(() => assertFreshTimestamp(at(ANALYTICS_FUTURE_SKEW_SECONDS - 1), NOW)).not.toThrow();
  });

  it("rejects a timestamp too far in the future", () => {
    let caught: unknown;
    try {
      assertFreshTimestamp(at(ANALYTICS_FUTURE_SKEW_SECONDS + 60), NOW);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("VALIDATION_FAILED");
  });

  it("rejects a stale timestamp older than the max age", () => {
    let caught: unknown;
    try {
      assertFreshTimestamp(at(-(ANALYTICS_MAX_AGE_SECONDS + 60)), NOW);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("VALIDATION_FAILED");
  });

  it("accepts a timestamp just inside the max age", () => {
    expect(() => assertFreshTimestamp(at(-(ANALYTICS_MAX_AGE_SECONDS - 60)), NOW)).not.toThrow();
  });

  it("rejects a malformed timestamp", () => {
    for (const bad of ["not-a-date", "", "2026-13-40T99:99:99Z"]) {
      let caught: unknown;
      try {
        assertFreshTimestamp(bad, NOW);
      } catch (e) {
        caught = e;
      }
      expect(caught, `expected "${bad}" to be rejected`).toBeInstanceOf(ApiError);
    }
  });

  it("keeps the limit generous for a human journey but finite", () => {
    expect(ANALYTICS_MAX_EVENTS).toBeGreaterThanOrEqual(30);
    expect(ANALYTICS_MAX_EVENTS).toBeLessThanOrEqual(600);
    expect(ANALYTICS_WINDOW_SECONDS).toBeGreaterThan(0);
  });
});
