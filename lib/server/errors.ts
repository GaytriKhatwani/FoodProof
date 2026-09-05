import "server-only";
import type { ErrorCode } from "@/lib/contracts";

/** Server-side typed error mapped to the API envelope (FOODPROOF_TECHNICAL_SPEC.md §6). */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { fields?: Record<string, string>; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.fields = opts?.fields;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
  }
}

/**
 * Marks a contract point that T0 froze but did not implement. T1–T3 replace
 * these; until then the surface fails loudly rather than pretending to work.
 */
export function notImplementedInT0(what: string): never {
  throw new ApiError(
    "DEPENDENCY_UNAVAILABLE",
    `${what} is not implemented in T0; owned by a later ticket.`,
  );
}
