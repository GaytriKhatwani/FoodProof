import type { NextRequest } from "next/server";
import { AiExtractRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { extractForReport } from "@/lib/server/ai/assist";

/**
 * `POST /api/reports/:id/ai/extract` — owner-only assisted label reading
 * (FOODPROOF_API_DETAILS.md "AI endpoints"). It returns SUGGESTIONS the reporter
 * must review; it never confirms facts and persists nothing, so there is no
 * Idempotency-Key: each call is a fresh, separately metered provider call.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const body = await parseJson(req, AiExtractRequest);
    const data = await extractForReport(ctx.actor.accessId, params.id, body);
    return jsonOk(data, requestId);
  });
}
