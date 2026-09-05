import type { NextRequest } from "next/server";
import type { Me } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";

/**
 * `GET /api/me` returns the current actor's label, demo role and analytics
 * consent state (for the withdraw control). It never returns invitation or
 * session secrets (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    const ctx = await requireSession(req);
    const me: Me = {
      label: ctx.actor.label,
      role: ctx.actor.role,
      analytics_consent: ctx.analytics.consent,
    };
    return jsonOk(me, requestId);
  });
}
