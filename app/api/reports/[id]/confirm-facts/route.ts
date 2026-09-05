import type { NextRequest } from "next/server";
import { ConfirmFactsRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { confirmFacts } from "@/lib/server/reports";

/**
 * `POST /api/reports/:id/confirm-facts` — explicit user confirmation of claim /
 * ingredients. The server timestamps confirmation and recomputes readiness;
 * changing label facts later clears it (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, ConfirmFactsRequest);
    const detail = await confirmFacts(ctx.actor.accessId, params.id, body, key);
    return jsonOk(detail, requestId);
  });
}
