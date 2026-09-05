import "server-only";
import type { NextRequest } from "next/server";
import { ApiError } from "./errors";
import { getServerEnv } from "./env";
import { hashAddress } from "./rate-limit";
import {
  SESSION_COOKIE,
  sessionService,
  type SessionContext,
} from "./session";

/**
 * Per-request authorization context (FOODPROOF_TECHNICAL_SPEC.md §2, §7).
 * Every guarded route resolves the actor from the stored session — never from
 * the request body or a client role label. Mutations additionally require a
 * same-origin request; no GET route ever mutates.
 */

export function rawSessionToken(req: NextRequest): string {
  return req.cookies.get(SESSION_COOKIE)?.value ?? "";
}

/** Resolve the current session, or null when there is none/expired/revoked. */
export function getSession(req: NextRequest): Promise<SessionContext | null> {
  return sessionService.resolveSession(rawSessionToken(req));
}

/** Require a valid pilot session; throws UNAUTHENTICATED otherwise. */
export async function requireSession(
  req: NextRequest,
): Promise<SessionContext> {
  const ctx = await getSession(req);
  if (!ctx) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.");
  return ctx;
}

/** Require a reviewer session; throws FORBIDDEN for a non-reviewer. */
export async function requireReviewer(
  req: NextRequest,
): Promise<SessionContext> {
  const ctx = await requireSession(req);
  if (ctx.actor.role !== "reviewer") {
    throw new ApiError("FORBIDDEN", "Reviewer access is required.");
  }
  return ctx;
}

/**
 * Reject cookie-authenticated mutations that are not same-origin
 * (FOODPROOF_TECHNICAL_SPEC.md §2). Uses the Origin header, falling back to
 * Referer; a request with neither is rejected.
 */
export function assertSameOrigin(req: NextRequest): void {
  const { APP_ORIGIN } = getServerEnv();
  const origin = req.headers.get("origin");
  if (origin) {
    if (origin === APP_ORIGIN) return;
    throw new ApiError("FORBIDDEN", "Cross-origin request rejected.");
  }
  const referer = req.headers.get("referer");
  if (referer && referer.startsWith(APP_ORIGIN)) return;
  throw new ApiError("FORBIDDEN", "Cross-origin request rejected.");
}

/**
 * Keyed HMAC of the originating address for the invitation limiter. Derived
 * from proxy headers; the raw address is never stored. Falls back to a constant
 * bucket when no address header is present (proportionate for the invited MVP).
 */
export function requestAddressHmac(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const address =
    (forwarded ? forwarded.split(",")[0]?.trim() : "") ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return hashAddress(address);
}
