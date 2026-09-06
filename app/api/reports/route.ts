import type { NextRequest } from "next/server";
import { ReportWriteRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { createReport } from "@/lib/server/reports";
import { listOwnReports } from "@/lib/server/data";
import { emitServerEvents } from "@/lib/server/analytics";
import { parseFlowId, reportSavedEvent } from "@/lib/server/analytics-events";

/**
 * `GET /api/reports` — own report summaries (owner set server-side, 20/page).
 * `POST /api/reports` — create a private draft; the owner is the session actor,
 * never a client-supplied id (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    const ctx = await requireSession(req);
    const cursor = req.nextUrl.searchParams.get("cursor");
    const { items, nextCursor } = await listOwnReports(ctx.actor.accessId, cursor);
    return jsonOk({ items, next_cursor: nextCursor }, requestId);
  });
}

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, ReportWriteRequest);
    const detail = await createReport(ctx.actor.accessId, body, key);
    // After commit only, from the persisted result (lib/server/analytics.ts).
    await emitServerEvents(ctx, key, [
      reportSavedEvent(detail, parseFlowId(req.headers), true),
    ]);
    return jsonOk(detail, requestId, { status: 201 });
  });
}
