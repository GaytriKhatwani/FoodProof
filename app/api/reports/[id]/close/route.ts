import type { NextRequest } from "next/server";
import { CloseRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { closeReport } from "@/lib/server/history";

/**
 * `POST /api/reports/:id/close` — owner closes the report; a reason is required
 * and an audit update is appended atomically (FOODPROOF_TECHNICAL_SPEC.md §6).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, CloseRequest);
    const detail = await closeReport(ctx.actor.accessId, params.id, body.reason, key);
    return jsonOk(detail, requestId);
  });
}
