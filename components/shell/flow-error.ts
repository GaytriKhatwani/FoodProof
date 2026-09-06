"use client";

import { clientAnalytics } from "@/lib/analytics";
import { flowErrorCode } from "@/lib/analytics/flow-error";

/**
 * One place that reports a blocking failure to analytics, shared by the public,
 * community and review screens.
 *
 * `flow_error_shown` carries exactly two allowlisted enums
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md §4): never a message, a product name, a
 * search term, an id, or any other free text. It is emitted where the failure
 * is actually shown to the participant — once per failed operation, not on
 * every rerender of the state it produced.
 */

/** `flow_error_shown.operation` values these screens can report. */
export type FlowOperation =
  | "load"
  | "save"
  | "upload"
  | "prepare_draft"
  | "handoff"
  | "publish"
  | "moderate";

/**
 * Emit `flow_error_shown` for a failure that is being displayed right now. The
 * `error_code` mapping lives in `lib/analytics/flow-error.ts` — one definition
 * shared with the reporter screens, so both report the same bucket.
 */
export function trackFlowError(operation: FlowOperation, error: unknown): void {
  clientAnalytics.track("flow_error_shown", {
    operation,
    error_code: flowErrorCode(error),
  });
}
