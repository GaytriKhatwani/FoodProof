import type { NextRequest } from "next/server";
import { ProductMatchQuery } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";
import { matchProducts } from "@/lib/server/products";

/**
 * `GET /api/products/matches?brand=&name=&variant=` — exact normalized matching
 * only, for a valid pilot session. Query text is never logged to analytics; no
 * automatic fuzzy merge (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    await requireSession(req);
    const sp = req.nextUrl.searchParams;
    const query = ProductMatchQuery.parse({
      brand: sp.get("brand") ?? undefined,
      name: sp.get("name") ?? undefined,
      variant: sp.get("variant") ?? undefined,
    });
    const matches = await matchProducts(query);
    return jsonOk({ matches }, requestId);
  });
}
