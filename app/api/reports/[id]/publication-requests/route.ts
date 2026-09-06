import type { NextRequest } from "next/server";
import { PublicationRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { requestPublication } from "@/lib/server/publication";
import { emitServerEvents } from "@/lib/server/analytics";
import { publicationRequestedEvent } from "@/lib/server/analytics-events";

/**
 * `POST /api/reports/:id/publication-requests` — owner requests review of a
 * concern (or a response, via source_update_id). The server freezes an
 * allowlisted snapshot from owned data; it never trusts a client public payload
 * (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, PublicationRequest);
    const result = await requestPublication(ctx.actor.accessId, params.id, body, key);
    await emitServerEvents(ctx, key, [publicationRequestedEvent(params.id, result)]);
    return jsonOk(result, requestId, { status: 201 });
  });
}
