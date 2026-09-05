import type { NextRequest } from "next/server";
import { ReportWriteRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { getOwnReport } from "@/lib/server/data";
import { patchReport } from "@/lib/server/reports";

/**
 * `GET /api/reports/:id` — owner-only aggregate for the private timeline/resume.
 * `PATCH /api/reports/:id` — typed fields + expected_version; no lifecycle,
 * publication or preparation mutation through this generic write.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    const ctx = await requireSession(req);
    const detail = await getOwnReport(ctx.actor.accessId, params.id);
    return jsonOk(detail, requestId);
  });
}

export function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, ReportWriteRequest);
    const detail = await patchReport(ctx.actor.accessId, params.id, body, key);
    return jsonOk(detail, requestId);
  });
}
