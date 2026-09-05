import { z } from "zod";

/**
 * Uniform API envelope (FOODPROOF_TECHNICAL_SPEC.md §6).
 * Success: { data, request_id }. Error: { error: { code, message, fields? }, request_id }.
 */

export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "DEPENDENCY_UNAVAILABLE",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Canonical HTTP status for each error code. */
export const HTTP_STATUS_FOR_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
};

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Field-level validation messages, keyed by field path. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
  request_id: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export interface ApiSuccess<T> {
  data: T;
  request_id: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiErrorBody;

export function isApiError(r: ApiResult<unknown>): r is ApiErrorBody {
  return (r as ApiErrorBody).error !== undefined;
}
