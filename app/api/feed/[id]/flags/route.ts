import type { NextRequest } from "next/server";
import { FlagRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { raiseFlag } from "@/lib/server/publication";

/**
 * `POST /api/feed/:id/flags` — any valid pilot session raises a correction /
 * removal flag on a visible concern. This is a private moderation signal, not a
 * public comment (FOODPROOF_TECHNICAL_SPEC.md §6).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, FlagRequest);
    const result = await raiseFlag(ctx.actor.accessId, params.id, body, key);
    return jsonOk(result, requestId, { status: 201 });
  });
}
