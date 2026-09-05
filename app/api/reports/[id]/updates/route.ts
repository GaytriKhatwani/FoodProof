import type { NextRequest } from "next/server";
import { UpdateCreateRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { recordUpdate } from "@/lib/server/history";

/**
 * `POST /api/reports/:id/updates` — owner adds a follow-up or a recorded
 * response; the matching submission must belong to this report
 * (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, UpdateCreateRequest);
    const update = await recordUpdate(ctx.actor.accessId, params.id, body, key);
    return jsonOk(update, requestId, { status: 201 });
  });
}
