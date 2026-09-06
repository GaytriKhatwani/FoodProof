import { ClientApiError } from "@/lib/client/api";

/**
 * THE mapping from a client failure onto the allowlisted `flow_error_shown`
 * `error_code` (FOODPROOF_MEASUREMENT_AND_PILOT.md §4).
 *
 * Both entry points delegate here — `components/shell/flow-error.ts` for the
 * public/community/review screens and `components/reporter/failure.ts` for the
 * reporter journey — so one funnel can be read across the whole demo. Before T4
 * the two disagreed: the reporter reported a dead connection as `unavailable`
 * while the community screens reported it as `network`.
 *
 * Rules, and why:
 *
 * - `DEPENDENCY_UNAVAILABLE` with `status === 0` is a true transport failure
 *   (offline, DNS, refused connection): `apiFetch` never received a response.
 *   That is `network`. The same code with a real HTTP status (503) is the
 *   service answering that it cannot serve: `unavailable`. Folding the two
 *   together would make `network` useless for spotting connectivity problems.
 * - `VALIDATION_FAILED` and `CONFLICT` are both preconditions the participant
 *   can resolve (fix a field, or reload and decide again), so both are
 *   `validation` — a 409 is not a fault of the service.
 * - Everything else — 401, 403, 404, 429, and any non-`ClientApiError` — is
 *   `unknown`. The allowlist has no auth or rate-limit value, and an expired
 *   demo session is deliberately NOT reported as a network problem.
 *
 * This module is browser-safe: it imports only the error class.
 */

export type FlowErrorCode = "network" | "validation" | "unavailable" | "unknown";

export function flowErrorCode(error: unknown): FlowErrorCode {
  if (!(error instanceof ClientApiError)) return "unknown";
  switch (error.code) {
    case "DEPENDENCY_UNAVAILABLE":
      return error.status === 0 ? "network" : "unavailable";
    case "VALIDATION_FAILED":
    case "CONFLICT":
      return "validation";
    default:
      return "unknown";
  }
}
