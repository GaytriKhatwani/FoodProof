"use client";

import { useCallback, useRef } from "react";
import { ClientApiError, idempotencyKey } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";

/**
 * Failure handling shared by every reporter screen (docs/FOODPROOF_SCREENS.md
 * "Shared interaction contract"). One place decides what a failed call means so
 * the screens never invent a success, never silently swallow an error, and
 * never wipe typed values:
 *
 * - `unavailable` — the demo backend is unreachable or returned 503. Show the
 *   explicit unavailable state with Retry. There is NO local fallback.
 * - `session_lost` — 401. The pilot shell (T3) owns the recovery UI; screens
 *   only say so and keep the form exactly as the user left it.
 * - `stale` — 409. Offer a reload, keeping unsaved text on screen.
 * - `validation` — 422 with optional per-field messages tied to inputs.
 * - `not_found` — 404 for an unknown or another owner's record.
 */

export type FailureKind =
  | "unavailable"
  | "session_lost"
  | "stale"
  | "validation"
  | "not_found"
  | "rate_limited"
  | "unknown";

export interface Failure {
  kind: FailureKind;
  message: string;
  fields?: Record<string, string>;
  retryAfterSeconds: number | null;
}

export function toFailure(error: unknown): Failure {
  if (error instanceof ClientApiError) {
    const base = {
      message: error.message,
      fields: error.fields,
      retryAfterSeconds: error.retryAfterSeconds,
    };
    switch (error.code) {
      case "DEPENDENCY_UNAVAILABLE":
        return { ...base, kind: "unavailable" };
      case "UNAUTHENTICATED":
        return { ...base, kind: "session_lost" };
      case "CONFLICT":
        return { ...base, kind: "stale" };
      case "VALIDATION_FAILED":
        return { ...base, kind: "validation" };
      case "NOT_FOUND":
        return { ...base, kind: "not_found" };
      case "RATE_LIMITED":
        return { ...base, kind: "rate_limited" };
      default:
        return { ...base, kind: "unknown" };
    }
  }
  return {
    kind: "unknown",
    message: "Something went wrong. Nothing was saved. Please try again.",
    retryAfterSeconds: null,
  };
}

/** Analytics `flow_error_shown.operation` values this flow can report. */
export type FlowOperation =
  | "load"
  | "save"
  | "upload"
  | "prepare_draft"
  | "handoff"
  | "publish";

function errorCodeFor(failure: Failure): "network" | "validation" | "unavailable" | "unknown" {
  switch (failure.kind) {
    case "unavailable":
      return "unavailable";
    case "validation":
    case "stale":
      return "validation";
    case "session_lost":
      return "network";
    default:
      return "unknown";
  }
}

/**
 * Emit the client-owned `flow_error_shown` event when a blocking failure is
 * actually displayed. Properties are the two allowlisted enums only — never a
 * message, product name, or any free text (FOODPROOF_MEASUREMENT_AND_PILOT.md §4).
 */
export function trackFlowError(operation: FlowOperation, failure: Failure): void {
  clientAnalytics.track("flow_error_shown", {
    operation,
    error_code: errorCodeFor(failure),
  });
}

/** Deterministic JSON so an unchanged payload hashes identically. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

/**
 * Idempotency-Key bookkeeping for one screen (lib/client/api.ts convention).
 * `keyFor` returns the SAME key while an action is retried with an unchanged
 * payload — so a retry replays the server's stored result instead of creating a
 * duplicate — and a NEW key as soon as the payload changes, because the server
 * rejects a reused key carrying a different body with 409. Call `settled` after
 * a success so a later, deliberate repeat of the same action is a new operation
 * rather than a replay of the old receipt.
 */
export function useIdempotencyKeys() {
  const keys = useRef(new Map<string, { hash: string; key: string }>());

  const keyFor = useCallback((action: string, payload: unknown): string => {
    const hash = stableStringify(payload);
    const current = keys.current.get(action);
    if (current && current.hash === hash) return current.key;
    const key = idempotencyKey();
    keys.current.set(action, { hash, key });
    return key;
  }, []);

  const settled = useCallback((action: string): void => {
    keys.current.delete(action);
  }, []);

  return { keyFor, settled };
}
