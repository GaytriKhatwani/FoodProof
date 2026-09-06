import type { NextRequest } from "next/server";
import { ClientAnalyticsEventRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { ingestClientEvent } from "@/lib/server/analytics";
import { ApiError } from "@/lib/server/errors";
import {
  analyticsRateLimiter,
  assertFreshTimestamp,
} from "@/lib/server/analytics-rate-limit";

/**
 * `POST /api/analytics` — allowlisted client-owned events only. The server
 * derives actor/role/consent/audience/session/mode/version and rejects any
 * client attempt to set them; events are dropped without consent. Analytics
 * failure never blocks the main action (which is a separate request)
 * (FOODPROOF_TECHNICAL_SPEC.md §9).
 *
 * Protection order: same-origin, then a valid session, then a persistent
 * per-session rate limit (before the body is parsed, so garbage floods are
 * cheap to reject), then a fresh, real `occurred_at`, then ingestion (which
 * enforces the client-owned allowlist and drops silently without consent). The
 * limiter is keyed by the opaque session access id — never a raw address.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);

    const decision = await analyticsRateLimiter.record(ctx.actor.accessId);
    if (!decision.allowed) {
      throw new ApiError(
        "RATE_LIMITED",
        "Too many analytics events. Please slow down.",
        { retryAfterSeconds: decision.retryAfterSeconds },
      );
    }

    const body = await parseJson(req, ClientAnalyticsEventRequest);
    assertFreshTimestamp(body.occurred_at);
    const result = await ingestClientEvent(ctx, body);
    return jsonOk(result, requestId);
  });
}
