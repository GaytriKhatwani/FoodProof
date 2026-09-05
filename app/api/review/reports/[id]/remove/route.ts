import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireReviewer } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { removeContent } from "@/lib/server/publication";

/**
 * `POST /api/review/reports/:id/remove` — reviewer only; hides content and
 * cancels pending approvals. A reason is required (FOODPROOF_TECHNICAL_SPEC.md §6).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RemoveRequest = z.object({ reason: z.string().trim().min(1) }).strict();

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireReviewer(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, RemoveRequest);
    const result = await removeContent(ctx.actor.accessId, params.id, body.reason, key);
    return jsonOk(result, requestId);
  });
}
