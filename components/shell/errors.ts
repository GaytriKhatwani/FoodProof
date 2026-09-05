import { ClientApiError } from "@/lib/client/api";

/**
 * Client-side classification of an API failure into the small set of states the
 * screens specify. The UI branches on the code, never on the message text, and
 * never invents a reason a request failed.
 */

export type FailureKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "unknown";

export function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ClientApiError)) return "unknown";
  switch (error.code) {
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    case "VALIDATION_FAILED":
      return "validation";
    case "CONFLICT":
      return "conflict";
    case "RATE_LIMITED":
      return "rate_limited";
    case "DEPENDENCY_UNAVAILABLE":
      return "unavailable";
    default:
      return "unknown";
  }
}

export function retryAfterSeconds(error: unknown): number | null {
  return error instanceof ClientApiError ? error.retryAfterSeconds : null;
}

/** Human wait wording for a 429, without promising when access returns. */
export function formatWait(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "Wait a short while before trying again.";
  }
  if (seconds < 60) {
    return `Wait about ${Math.ceil(seconds)} seconds before trying again.`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `Wait about ${minutes} minute${minutes === 1 ? "" : "s"} before trying again.`;
}

/**
 * Copy for a failed read. `unavailable` is stated explicitly — the demo never
 * falls back to local content — and anything unexpected stays generic rather
 * than echoing a server message the reader cannot act on.
 */
export function loadFailureCopy(error: unknown): { title: string; body: string } {
  switch (failureKind(error)) {
    case "unavailable":
      return {
        title: "The demo backend is unavailable",
        body: "This screen could not reach the demo service, so nothing is shown. Nothing was loaded from this browser instead.",
      };
    case "forbidden":
      return {
        title: "This area needs a reviewer invitation",
        body: "Your invitation opens the community pilot, not the review queue. Roles are set by the invitation; there is no switch in this interface.",
      };
    case "not_found":
      return {
        title: "This record is not available",
        body: "It may never have been published, or it may have been withdrawn by its reporter or removed in review.",
      };
    case "rate_limited":
      return {
        title: "Too many requests",
        body: formatWait(retryAfterSeconds(error)),
      };
    default:
      return {
        title: "This screen could not be loaded",
        body: "Something went wrong while loading. Try again.",
      };
  }
}
