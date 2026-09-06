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
 * `supabase/migrations/0003_transactional_operations.sql` and
 * `0004_publication_atomicity_and_ai_spend.sql`, mapped onto the existing API
 * error codes so HTTP responses are unchanged for callers. FP402 (AI budget
 * exhausted) deliberately maps to the same generic 503 as a provider failure:
 * the UI shows one honest "AI assistance unavailable" state for every reason.
 */
const RPC_ERROR_CODES: Record<string, ErrorCode> = {
  FP402: "DEPENDENCY_UNAVAILABLE",
  FP403: "FORBIDDEN",
  FP404: "NOT_FOUND",
  FP409: "CONFLICT",
  FP422: "VALIDATION_FAILED",
  FP429: "RATE_LIMITED",
};

/** Migration files that define the `fp_*` functions, by name. */
export const MIGRATION_0003 = "supabase/migrations/0003_transactional_operations.sql";
export const MIGRATION_0004 = "supabase/migrations/0004_publication_atomicity_and_ai_spend.sql";
export const MIGRATION_0005 = "supabase/migrations/0005_pilot_integrity_hardening.sql";

/** The shape supabase-js returns for a failed PostgREST/RPC call. */
export interface RpcErrorLike {
  code?: string | null;
  message?: string | null;
  /** Postgres error HINT; `fp_reserve_ai_spend` carries Retry-After seconds here. */
  hint?: string | null;
}

/**
 * Translate an RPC failure. A typed guard failure becomes its ApiError; a
 * missing function (PostgREST `PGRST202`) becomes an explicit, loud server error
 * that names the migration — there is deliberately NO fallback to the old
 * non-transactional path, because that path is exactly what these functions
 * replace. Anything else is returned unchanged so the route logs it and answers
 * with the generic 503.
 */
export function mapRpcError(fn: string, error: unknown, migration: string = MIGRATION_0003): unknown {
  const e = (error ?? {}) as RpcErrorLike;
  const mapped = e.code ? RPC_ERROR_CODES[e.code] : undefined;
  if (mapped) {
    const retryAfter = mapped === "RATE_LIMITED" ? Number(e.hint) : NaN;
    return new ApiError(mapped, e.message ?? "The request could not be completed.", {
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    });
  }
  if (e.code === "PGRST202" || /could not find the function/i.test(e.message ?? "")) {
    return new ApiError(
      "DEPENDENCY_UNAVAILABLE",
      `The database function ${fn}() is missing. Apply ${migration} to this Supabase project.`,
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
