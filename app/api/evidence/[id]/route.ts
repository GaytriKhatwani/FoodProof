import { NextResponse, type NextRequest } from "next/server";
import { EvidenceRolesPatch } from "@/lib/contracts";
import { jsonOk, parseJson, route } from "@/lib/server/http";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import {
  patchEvidenceRoles,
  readEvidenceForMedia,
  removeEvidence,
} from "@/lib/server/evidence";

/**
 * `GET /api/evidence/:id` streams bytes for the owner (or a reviewer while the
 * report has a pending review case) through this guarded route — never a public
 * URL. `PATCH` changes owner role tags; `DELETE` removes from a private draft.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const ctx = await requireSession(req);
    const { bytes, mimeType } = await readEvidenceForMedia(ctx.actor, params.id);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, no-store" },
    });
  });
}

export function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const body = await parseJson(req, EvidenceRolesPatch);
    const meta = await patchEvidenceRoles(ctx.actor.accessId, params.id, body, key);
    return jsonOk(meta, requestId);
  });
}

export function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);
    const result = await removeEvidence(ctx.actor.accessId, params.id, key);
    return jsonOk(result, requestId);
  });
}
