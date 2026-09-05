import type { NextRequest } from "next/server";
import { AnalyticsConsentRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, rawSessionToken, requireSession } from "@/lib/server/context";
import { setAnalyticsConsent } from "@/lib/server/session";

/**
 * `PUT /api/me/analytics-consent` sets allow/decline. The server mints random
 * analytics identifiers only on allow and clears them on decline; analytics is
 * never required for use (FOODPROOF_TECHNICAL_SPEC.md §6/§9). This response is
 * deliberately not stored in idempotency receipts.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function PUT(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    await requireSession(req);
    const body = await parseJson(req, AnalyticsConsentRequest);
    const { consent } = await setAnalyticsConsent(rawSessionToken(req), body.allowed);
    return jsonOk({ analytics_consent: consent }, requestId);
  });
}
