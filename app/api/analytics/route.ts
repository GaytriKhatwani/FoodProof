import type { NextRequest } from "next/server";
import { ClientAnalyticsEventRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { ingestClientEvent } from "@/lib/server/analytics";

/**
 * `POST /api/analytics` — allowlisted client-owned events only. The server
 * derives actor/role/consent/audience/session/mode/version and rejects any
 * client attempt to set them; events are dropped without consent. Analytics
 * failure never blocks the main action (which is a separate request)
 * (FOODPROOF_TECHNICAL_SPEC.md §9).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const body = await parseJson(req, ClientAnalyticsEventRequest);
    const result = await ingestClientEvent(ctx, body);
    return jsonOk(result, requestId);
  });
}
