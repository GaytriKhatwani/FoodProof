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
 * SQLSTATEs raised by the transactional functions in
 * `supabase/migrations/0003_transactional_operations.sql`, mapped onto the
 * existing API error codes so HTTP responses are unchanged for callers.
 */
const RPC_ERROR_CODES: Record<string, ErrorCode> = {
  FP403: "FORBIDDEN",
  FP404: "NOT_FOUND",
  FP409: "CONFLICT",
  FP422: "VALIDATION_FAILED",
};

/** The shape supabase-js returns for a failed PostgREST/RPC call. */
export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Translate an RPC failure. A typed guard failure becomes its ApiError; a
 * missing function (PostgREST `PGRST202`) becomes an explicit, loud server error
 * that names the migration — there is deliberately NO fallback to the old
 * non-transactional path, because that path is exactly what these functions
 * replace. Anything else is returned unchanged so the route logs it and answers
 * with the generic 503.
 */
export function mapRpcError(fn: string, error: unknown): unknown {
  const e = (error ?? {}) as RpcErrorLike;
  const mapped = e.code ? RPC_ERROR_CODES[e.code] : undefined;
  if (mapped) {
    return new ApiError(mapped, e.message ?? "The request could not be completed.");
  }
  if (e.code === "PGRST202" || /could not find the function/i.test(e.message ?? "")) {
    return new ApiError(
      "DEPENDENCY_UNAVAILABLE",
      `The database function ${fn}() is missing. Apply ` +
        "supabase/migrations/0003_transactional_operations.sql to this Supabase project.",
    );
  }
  return error;
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
