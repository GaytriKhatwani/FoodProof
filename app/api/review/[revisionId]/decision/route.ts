import type { NextRequest } from "next/server";
import { ReviewDecisionRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireReviewer } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { decideReview } from "@/lib/server/publication";
import { emitServerEvents } from "@/lib/server/analytics";
import { decisionEvents } from "@/lib/server/analytics-events";

/**
 * `POST /api/review/:revisionId/decision` — reviewer only; approve /
 * request_changes / reject with expected_version and a reason where required.
 * One guarded transition performs the decision and (on approve) the pointer move
 * (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(
  req: NextRequest,
  { params }: { params: { revisionId: string } },
) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireReviewer(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, ReviewDecisionRequest);
    const result = await decideReview(ctx.actor.accessId, params.revisionId, body, key);
    // The reviewer is the actor; their consent governs collection.
    await emitServerEvents(ctx, key, decisionEvents(result, body.action));
    return jsonOk(result, requestId);
  });
}
