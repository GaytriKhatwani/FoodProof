import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  HTTP_STATUS_FOR_CODE,
  type ApiErrorBody,
  type ApiSuccess,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import type { SessionCookie } from "./session";

/**
 * Route-handler helpers that render the uniform API envelope
 * (FOODPROOF_TECHNICAL_SPEC.md §6). Success: { data, request_id }.
 * Error: { error: { code, message, fields? }, request_id } with the canonical
 * HTTP status, plus Retry-After on RATE_LIMITED. Stack traces and raw provider
 * errors are never exposed.
 */

/** Pilot data and evidence responses are never cached (FOODPROOF_TECHNICAL_SPEC.md §2). */
export const PILOT_CACHE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function jsonOk<T>(
  data: T,
  requestId: string,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  const body: ApiSuccess<T> = { data, request_id: requestId };
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: { ...PILOT_CACHE_HEADERS, ...init?.headers },
  });
}

export function jsonError(err: ApiError, requestId: string): NextResponse {
  const body: ApiErrorBody = {
    error: { code: err.code, message: err.message, fields: err.fields },
    request_id: requestId,
  };
  const headers: Record<string, string> = { ...PILOT_CACHE_HEADERS };
  if (err.code === "RATE_LIMITED" && err.retryAfterSeconds != null) {
    headers["Retry-After"] = String(err.retryAfterSeconds);
  }
  return NextResponse.json(body, {
    status: HTTP_STATUS_FOR_CODE[err.code],
    headers,
  });
}

/**
 * Coerce any thrown value into a client-safe ApiError. Zod failures become
 * VALIDATION_FAILED with field messages; anything unexpected is logged
 * server-side (with the request id) and surfaced as a generic 503 so no stack
 * trace or internal detail leaks.
 */
export function toApiError(e: unknown, requestId: string): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof z.ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      fields[issue.path.join(".") || "_"] = issue.message;
    }
    return new ApiError("VALIDATION_FAILED", "Validation failed.", { fields });
  }
  // Never expose the underlying error to the client; keep a server-side trace.
  console.error(`[foodproof] unexpected error (request ${requestId}):`, e);
  return new ApiError("DEPENDENCY_UNAVAILABLE", "The service could not complete the request.");
}

/**
 * Wrap a route handler: generate a request id, run the handler, and turn any
 * thrown ApiError/ZodError/unexpected error into the uniform envelope.
 */
export function route(
  handler: (requestId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = newRequestId();
  return handler(requestId).catch((e) =>
    jsonError(toApiError(e, requestId), requestId),
  );
}

/** Apply a session cookie (set or clear) to a response. */
export function applyCookie(res: NextResponse, cookie: SessionCookie): void {
  res.cookies.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    maxAge: cookie.maxAgeSeconds,
    path: "/",
  });
}

/** Parse and validate a JSON request body, mapping failures to VALIDATION_FAILED. */
export async function parseJson<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError("VALIDATION_FAILED", "Request body must be valid JSON.");
  }
  return schema.parse(raw);
}
