import type { NextRequest } from "next/server";
import { EmailSignInRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requestAddressHmac } from "@/lib/server/context";
import { requestEmailCode } from "@/lib/server/auth-email";

/**
 * `POST /api/auth/email/request` asks the provider to send a one-time sign-in
 * code to an address (FOODPROOF_TECHNICAL_SPEC.md §2 "Phase two C.1",
 * FOODPROOF_API_DETAILS.md).
 *
 * The answer is always `{ requested: true }` on success, whether or not that
 * address already has an account: this endpoint can never be used to test who is
 * a FoodProof user. The code itself only ever travels by email; it is never in
 * the response, a log line, or an analytics property. With `EMAIL_SIGN_IN`
 * unset the route answers DEPENDENCY_UNAVAILABLE and the invitation path is
 * unaffected.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const body = await parseJson(req, EmailSignInRequest);
    const data = await requestEmailCode(body.email, requestAddressHmac(req));
    return jsonOk(data, requestId);
  });
}
