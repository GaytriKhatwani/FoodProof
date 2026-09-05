import type { NextRequest } from "next/server";
import { EvidenceUploadMeta } from "@/lib/contracts";
import { jsonOk, route } from "@/lib/server/http";
import { ApiError } from "@/lib/server/errors";
import { assertSameOrigin, requireSession } from "@/lib/server/context";
import { requireIdempotencyKey } from "@/lib/server/idempotency";
import { addEvidence } from "@/lib/server/evidence";

/**
 * `POST /api/reports/:id/evidence` — owner multipart upload, one file per
 * request, max 3 MB, content-type sniffed server-side (FOODPROOF_TECHNICAL_SPEC.md
 * §6). Form fields: `file`, `kind`, optional `roles` (JSON array).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async (requestId) => {
    assertSameOrigin(req);
    const ctx = await requireSession(req);
    const key = requireIdempotencyKey(req);

    const form = await req.formData().catch(() => {
      throw new ApiError("VALIDATION_FAILED", "Expected a multipart form upload.");
    });
    const file = form.get("file");
    if (!(file instanceof Blob)) {
      throw new ApiError("VALIDATION_FAILED", "A file field is required.");
    }
    const rolesRaw = form.get("roles");
    let roles: unknown = [];
    if (typeof rolesRaw === "string" && rolesRaw.trim()) {
      try {
        roles = JSON.parse(rolesRaw);
      } catch {
        throw new ApiError("VALIDATION_FAILED", "roles must be a JSON array.");
      }
    }
    const meta = EvidenceUploadMeta.parse({ kind: form.get("kind"), roles });
    const bytes = new Uint8Array(await file.arrayBuffer());

    const evidence = await addEvidence(ctx.actor.accessId, params.id, meta, { bytes }, key);
    return jsonOk(evidence, requestId, { status: 201 });
  });
}
