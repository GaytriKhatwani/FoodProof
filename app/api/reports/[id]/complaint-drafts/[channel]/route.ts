import type { NextRequest } from "next/server";
import { Channel, ComplaintDraftWriteRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { saveComplaintDraft } from "@/lib/server/drafts";
import { emitServerEvents } from "@/lib/server/analytics";
import { complaintDraftSavedEvent } from "@/lib/server/analytics-events";

/**
 * `PUT /api/reports/:id/complaint-drafts/:channel` — owner saves subject/body/
 * method with expected_version (null on first save). Returns the persisted draft
 * (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PUT(
  req: NextRequest,
  { params }: { params: { id: string; channel: string } },
) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const channel = Channel.parse(params.channel);
    const body = await parseJson(req, ComplaintDraftWriteRequest);
    const draft = await saveComplaintDraft(ctx.actor.accessId, params.id, channel, body, key);
    await emitServerEvents(ctx, key, [complaintDraftSavedEvent(params.id, draft)]);
    return jsonOk(draft, requestId);
  });
}
