import type { NextRequest } from "next/server";
import { jsonOk, route } from "@/lib/server/http";
import { requireReviewer } from "@/lib/server/context";
import { getReviewDetail } from "@/lib/server/data";

/**
 * `GET /api/review/:revisionId` — reviewer only; the exact frozen snapshot and
 * its associated asset ids for the queued case. The revision id is distinct from
 * the report id (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, { params }: { params: { revisionId: string } }) {
  return route(async (requestId) => {
    await requireReviewer(req);
    const detail = await getReviewDetail(params.revisionId);
    return jsonOk(detail, requestId);
  });
}
