import type { NextRequest } from "next/server";
import type { Me } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";
import { isAiConfigured } from "@/lib/server/ai";

/**
 * `GET /api/me` returns the current actor's label, demo role, analytics consent
 * state (for the withdraw control) and whether the AI path is configured. It
 * never returns invitation or session secrets (FOODPROOF_API_DETAILS.md);
 * `ai_available` is a boolean capability flag, not a credential.
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
      ai_available: isAiConfigured(),
    };
    return jsonOk(me, requestId);
  });
}
