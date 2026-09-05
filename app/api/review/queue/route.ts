import type { NextRequest } from "next/server";
import { jsonOk, route } from "@/lib/server/http";
import { requireReviewer } from "@/lib/server/context";
import { getReviewQueue } from "@/lib/server/data";

/**
 * `GET /api/review/queue` — reviewer only; pending review requests and open
 * flags. There is no generic "list all private reports" call
 * (FOODPROOF_TECHNICAL_SPEC.md §6/§7).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    await requireReviewer(req);
    const queue = await getReviewQueue();
    return jsonOk(queue, requestId);
  });
}
