import type { NextRequest } from "next/server";
import { jsonOk, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";
import { getPublicReport } from "@/lib/server/data";

/**
 * `GET /api/feed/:id` — the approved public projection for a report id, plus its
 * approved response summaries, for any valid pilot session. Only visible content
 * is returned; no private-derived status (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    await requireSession(req);
    const report = await getPublicReport(params.id);
    return jsonOk(report, requestId);
  });
}
