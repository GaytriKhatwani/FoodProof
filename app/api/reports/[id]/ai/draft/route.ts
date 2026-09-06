import type { NextRequest } from "next/server";
import { AiDraftRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { draftForReport } from "@/lib/server/ai/assist";

/**
 * `POST /api/reports/:id/ai/draft` — owner-only assisted complaint suggestion
 * (FOODPROOF_API_DETAILS.md "AI endpoints"). Confirmed facts are required, the
 * result is editable, and saving it is the separate
 * `PUT /api/reports/:id/complaint-drafts/:channel`. Nothing is persisted here,
 * so there is no Idempotency-Key.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const body = await parseJson(req, AiDraftRequest);
    const data = await draftForReport(ctx.actor.accessId, params.id, body.channel);
    return jsonOk(data, requestId);
  });
}
