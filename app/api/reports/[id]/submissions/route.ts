import type { NextRequest } from "next/server";
import { SubmissionCreateRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { recordSubmission } from "@/lib/server/history";
import { emitServerEvents } from "@/lib/server/analytics";
import { submissionRecordedEvent } from "@/lib/server/analytics-events";

/**
 * `POST /api/reports/:id/submissions` — owner records an external submission
 * (channel/recipient/date/reference/optional acknowledgement). Always
 * user-recorded; attachments must belong to the report (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, SubmissionCreateRequest);
    const submission = await recordSubmission(ctx.actor.accessId, params.id, body, key);
    await emitServerEvents(ctx, key, [submissionRecordedEvent(params.id, submission)]);
    return jsonOk(submission, requestId, { status: 201 });
  });
}
