import type { NextRequest } from "next/server";
import { EmailSignInVerifyRequest, type Me } from "@/lib/contracts";
import { applyCookie, jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requestAddressHmac } from "@/lib/server/context";
import { verifyEmailCode } from "@/lib/server/auth-email";

/**
 * `POST /api/auth/email/verify` exchanges a one-time code for the same session
 * cookie an invitation code produces (FOODPROOF_TECHNICAL_SPEC.md §2 "Phase two
 * C.1", FOODPROOF_API_DETAILS.md).
 *
 * The response mirrors `POST /api/demo/session` so both entry paths hand the UI
 * the same three fields. The role comes from stored records and the deployed
 * moderator allowlist, never from the body; no provider token, one-time code or
 * key appears in the response; and logout stays `DELETE /api/demo/session`,
 * which ends either kind of session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const body = await parseJson(req, EmailSignInVerifyRequest);
    const { actor, expiresAt, cookie } = await verifyEmailCode(
      body.email,
      body.code,
      requestAddressHmac(req),
    );
    const data: Pick<Me, "label" | "role"> & { expires_at: string } = {
      label: actor.label,
      role: actor.role,
      expires_at: expiresAt,
    };
    const res = jsonOk(data, requestId);
    applyCookie(res, cookie);
    return res;
  });
}
