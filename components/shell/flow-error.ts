"use client";

import { ClientApiError } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import { failureKind } from "./errors";

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

type FlowErrorCode = "network" | "validation" | "unavailable" | "unknown";

/**
 * Map a client failure onto the allowlisted `error_code`.
 *
 * A true transport failure (offline, DNS, refused connection) reaches the UI as
 * `DEPENDENCY_UNAVAILABLE` with `status: 0`, because `apiFetch` never got a
 * response; a 503 is the same code with a real status. They are separated here
 * so `network` means what it says and is not folded into `unavailable`.
 *
 * A 409 is bucketed as `validation`: it is a precondition the participant can
 * resolve (reload and decide again), not a fault of the service. This matches
 * the reporter screens' mapping in `components/reporter/failure.ts` so one
 * funnel can be read across both flows. An expired demo session is deliberately
 * NOT `network` — the allowlist has no auth value, so it stays `unknown`
 * rather than polluting a bucket that is used to spot connectivity problems.
 */
function flowErrorCode(error: unknown): FlowErrorCode {
  if (error instanceof ClientApiError && error.code === "DEPENDENCY_UNAVAILABLE") {
    return error.status === 0 ? "network" : "unavailable";
  }
  switch (failureKind(error)) {
    case "unavailable":
      return "unavailable";
    case "validation":
    case "conflict":
      return "validation";
    default:
      return "unknown";
  }
}

/** Emit `flow_error_shown` for a failure that is being displayed right now. */
export function trackFlowError(operation: FlowOperation, error: unknown): void {
  clientAnalytics.track("flow_error_shown", {
    operation,
    error_code: flowErrorCode(error),
  });
}
