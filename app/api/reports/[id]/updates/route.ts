import type { NextRequest } from "next/server";
import { UpdateCreateRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { recordUpdate, submissionChannel } from "@/lib/server/history";
import { emitServerEvents } from "@/lib/server/analytics";
import { updateRecordedEvent } from "@/lib/server/analytics-events";

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
    // The update carries no channel of its own; it comes from its submission.
    const channel = update.submission_id
      ? await submissionChannel(params.id, update.submission_id)
      : null;
    await emitServerEvents(ctx, key, [
      channel ? updateRecordedEvent(params.id, update, channel) : null,
    ]);
    return jsonOk(update, requestId, { status: 201 });
  });
}
