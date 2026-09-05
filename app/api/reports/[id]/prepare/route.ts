import type { NextRequest } from "next/server";
import { PrepareRequest } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { prepareDraft } from "@/lib/server/drafts";

/**
 * `POST /api/reports/:id/prepare` — validates confirmed facts and returns a
 * deterministic, editable complaint template. It never saves or sends and emits
 * no saved event (FOODPROOF_API_DETAILS.md).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const body = await parseJson(req, PrepareRequest);
    const draft = await prepareDraft(ctx.actor.accessId, params.id, body.channel);
    return jsonOk(draft, requestId);
  });
}
