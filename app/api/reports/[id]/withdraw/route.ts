import type { NextRequest } from "next/server";
import { jsonOk, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { withdrawPublication } from "@/lib/server/publication";
import { emitServerEvents } from "@/lib/server/analytics";
import { publicationWithdrawnEvent } from "@/lib/server/analytics-events";

/**
 * `POST /api/reports/:id/withdraw` — owner hides the publication and invalidates
 * any pending approval requests atomically (FOODPROOF_TECHNICAL_SPEC.md §6). The
 * private history is preserved; withdrawal is not deletion.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const result = await withdrawPublication(ctx.actor.accessId, params.id, key);
    await emitServerEvents(ctx, key, [publicationWithdrawnEvent(result)]);
    return jsonOk(result, requestId);
  });
}
