import type { NextRequest } from "next/server";
import type { Me } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { rawSessionToken, requireSession } from "@/lib/server/context";
import { isAiConfigured } from "@/lib/server/ai";
import { getOfficialDestination } from "@/lib/server/official";
import { verifiedAccountEmail } from "@/lib/server/auth-email";
import { sessionService } from "@/lib/server/session";

/**
 * `GET /api/me` returns the current actor's label, demo role, analytics consent
 * state (for the withdraw control) and whether the AI path is configured. It
 * never returns invitation or session secrets (FOODPROOF_API_DETAILS.md);
 * `ai_available` is a boolean capability flag, not a credential.
 *
 * Phase two C.1 adds `sign_in_method` and, for a verified account, the `email`
 * that account signed in with. The address is read from the auth provider for
 * this one response — the application tables never store it — and this is the
 * ONLY route that looks it up, so no other request pays for the round trip.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return route(async (requestId) => {
    const ctx = await requireSession(req);
    // A verified account that has been deleted or banned at the provider must
    // stop working immediately, even though its FoodProof session has not
    // expired yet: end the session and answer as an unauthenticated caller.
    const email = await verifiedAccountEmail(ctx.actor, () =>
      sessionService.destroySession(rawSessionToken(req)),
    );
    const me: Me = {
      label: ctx.actor.label,
      role: ctx.actor.role,
      analytics_consent: ctx.analytics.consent,
      ai_available: isAiConfigured(),
      official_portal: getOfficialDestination(),
      sign_in_method: ctx.signInMethod,
      email,
    };
    return jsonOk(me, requestId);
  });
}
