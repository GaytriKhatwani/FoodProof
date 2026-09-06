import { describe, expect, it, vi } from "vitest";
import { ClientApiError } from "@/lib/client/api";
import type { ErrorCode } from "@/lib/contracts";
import { flowErrorCode } from "@/lib/analytics/flow-error";
import { toFailure } from "@/components/reporter/failure";

/**
 * `flow_error_shown.error_code` alignment (T4). Before this slice the reporter
 * screens and the community/review screens mapped the same failure differently
 * (`unavailable` vs `network` for a dead connection), so one funnel could not be
 * read across the demo. Both entry points now go through
 * `lib/analytics/flow-error.ts`; this test pins that they agree for every code
 * the API can return, and that the reporter's `Failure` carries the same value.
 */

function apiError(code: ErrorCode, status: number): ClientApiError {
  return new ClientApiError({
    code,
    message: "test",
    requestId: null,
    status,
    retryAfterSeconds: null,
  });
}

/**
 * The community/review entry point, observed through the analytics adapter — the
 * value actually put on the wire, not a re-implementation of the mapping.
 */
async function communityCode(error: unknown): Promise<unknown> {
  const analytics = await import("@/lib/analytics");
  const spy = vi.spyOn(analytics.clientAnalytics, "track").mockImplementation(() => {});
  const { trackFlowError } = await import("@/components/shell/flow-error");
  trackFlowError("load", error);
  const properties = spy.mock.calls[0]![1] as { error_code: string };
  spy.mockRestore();
  return properties.error_code;
}

const cases: { name: string; error: unknown; expected: string }[] = [
  { name: "transport failure (no response)", error: apiError("DEPENDENCY_UNAVAILABLE", 0), expected: "network" },
  { name: "503 from the service", error: apiError("DEPENDENCY_UNAVAILABLE", 503), expected: "unavailable" },
  { name: "422 validation", error: apiError("VALIDATION_FAILED", 422), expected: "validation" },
  { name: "409 conflict", error: apiError("CONFLICT", 409), expected: "validation" },
  { name: "401 expired session", error: apiError("UNAUTHENTICATED", 401), expected: "unknown" },
  { name: "403 forbidden", error: apiError("FORBIDDEN", 403), expected: "unknown" },
  { name: "404 not found", error: apiError("NOT_FOUND", 404), expected: "unknown" },
  { name: "429 rate limited", error: apiError("RATE_LIMITED", 429), expected: "unknown" },
  { name: "a thrown non-API error", error: new TypeError("boom"), expected: "unknown" },
  { name: "a non-error value", error: "oops", expected: "unknown" },
];

describe("flow_error_shown error_code", () => {
  for (const c of cases) {
    it(`maps ${c.name} to ${c.expected} in BOTH entry points`, async () => {
      // 1. the shared mapping
      expect(flowErrorCode(c.error)).toBe(c.expected);
      // 2. the reporter entry point (computed at toFailure time, from the
      //    ORIGINAL error, and carried on the Failure that screens display)
      expect(toFailure(c.error).error_code).toBe(c.expected);
      // 3. the community/review entry point, as emitted
      expect(await communityCode(c.error)).toBe(c.expected);
    });
  }

  it("keeps the reporter's conflict recovery states on ONE analytics bucket", () => {
    const conflict = apiError("CONFLICT", 409);
    for (const conflictAs of ["stale", "locked", "already_pending"] as const) {
      const failure = toFailure(conflict, { conflictAs });
      expect(failure.kind).toBe(conflictAs);
      // Different recovery UI, same measurement bucket.
      expect(failure.error_code).toBe("validation");
    }
  });

  it("separates a dead connection from a 503 even though both show one UI state", () => {
    // `kind` is deliberately the same (the screens show one recovery state);
    // the analytics bucket is not.
    expect(toFailure(apiError("DEPENDENCY_UNAVAILABLE", 0)).kind).toBe("unavailable");
    expect(toFailure(apiError("DEPENDENCY_UNAVAILABLE", 503)).kind).toBe("unavailable");
    expect(toFailure(apiError("DEPENDENCY_UNAVAILABLE", 0)).error_code).toBe("network");
    expect(toFailure(apiError("DEPENDENCY_UNAVAILABLE", 503)).error_code).toBe("unavailable");
  });
});
