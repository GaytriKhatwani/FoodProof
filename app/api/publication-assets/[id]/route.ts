import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/context";
import { readPublicationAssetForMedia } from "@/lib/server/data";

/**
 * `GET /api/publication-assets/:id` — streams a reviewed asset for a valid pilot
 * session while the parent is currently visible (or a reviewer during review).
 * Never a long-lived URL, so withdrawal takes effect for later requests
 * (FOODPROOF_TECHNICAL_SPEC.md §5).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return route(async () => {
    const ctx = await requireSession(req);
    const { bytes, mimeType } = await readPublicationAssetForMedia(ctx.actor, params.id);
    return new NextResponse(Buffer.from(bytes), {
      headers: { "Content-Type": mimeType, "Cache-Control": "private, no-store" },
    });
  });
}
