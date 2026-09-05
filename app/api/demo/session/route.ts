import type { NextRequest } from "next/server";
import { SessionCreateRequest, type Me } from "@/lib/contracts";
import { applyCookie, jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, rawSessionToken, requestAddressHmac } from "@/lib/server/context";
import { clearedCookie, sessionService } from "@/lib/server/session";

/**
 * `POST /api/demo/session` exchanges an invitation code for a session cookie;
 * `DELETE` logs out. The client never supplies a role, and no invitation or
 * session secret appears in the response JSON (FOODPROOF_TECHNICAL_SPEC.md §2,
 * FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const body = await parseJson(req, SessionCreateRequest);
    const { actor, expiresAt, cookie } = await sessionService.createSession(
      body.invitation_code,
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

export function DELETE(req: NextRequest) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    await sessionService.destroySession(rawSessionToken(req));
    const res = jsonOk({ ended: true }, requestId);
    applyCookie(res, clearedCookie());
    return res;
  });
}
