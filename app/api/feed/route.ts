import type { NextRequest } from "next/server";
import { FeedQuery } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";
import { getFeed } from "@/lib/server/data";

/**
 * `GET /api/feed?q=&cursor=` — approved projections only, for any valid pilot
 * session, newest first, 20/page. The public homepage never calls this; the
 * guard enforces it regardless (FOODPROOF_TECHNICAL_SPEC.md §6). Raw search text
 * is never logged to analytics.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    await requireSession(req);
    const sp = req.nextUrl.searchParams;
    const query = FeedQuery.parse({
      q: sp.get("q") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
    });
    const { items, nextCursor } = await getFeed(query);
    return jsonOk({ items, next_cursor: nextCursor }, requestId);
  });
}
