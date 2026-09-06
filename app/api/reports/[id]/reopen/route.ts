import type { NextRequest } from "next/server";
import { jsonOk, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { reopenReport } from "@/lib/server/history";
import { emitServerEvents } from "@/lib/server/analytics";
import { lifecycleEvent } from "@/lib/server/analytics-events";

/**
 * `POST /api/reports/:id/reopen` — owner reopens a closed report; an audit
 * update is appended atomically (FOODPROOF_TECHNICAL_SPEC.md §6).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const detail = await reopenReport(ctx.actor.accessId, params.id, key);
    await emitServerEvents(ctx, key, [lifecycleEvent(detail, "reopened")]);
    return jsonOk(detail, requestId);
  });
}
