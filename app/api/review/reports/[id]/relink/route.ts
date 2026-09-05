import type { NextRequest } from "next/server";
import { RelinkRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireReviewer } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { relinkProduct } from "@/lib/server/publication";

/**
 * `POST /api/review/reports/:id/relink` — reviewer only; relink a report to a
 * target product with a logged reason. Report history is preserved; the approved
 * public text is not silently changed (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireReviewer(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, RelinkRequest);
    const result = await relinkProduct(ctx.actor.accessId, params.id, body, key);
    return jsonOk(result, requestId);
  });
}
