import type { NextRequest } from "next/server";
import { z } from "zod";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireReviewer } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { resolveFlag } from "@/lib/server/publication";

/**
 * `POST /api/review/flags/:id/resolve` — reviewer only; records the decision and
 * optionally removes the associated publication atomically
 * (FOODPROOF_TECHNICAL_SPEC.md §6).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FlagResolveRequest = z
  .object({ note: z.string().trim().min(1).optional(), remove: z.boolean().optional() })
  .strict();

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireReviewer(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, FlagResolveRequest);
    const result = await resolveFlag(ctx.actor.accessId, params.id, body, key);
    return jsonOk(result, requestId);
  });
}
