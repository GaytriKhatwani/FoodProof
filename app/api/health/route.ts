import { NextResponse } from "next/server";
import { serverEnvStatus } from "@/lib/server/env";
import {
  HTTP_STATUS_FOR_CODE,
  type ApiErrorBody,
  type ApiSuccess,
} from "@/lib/contracts";

/**
 * Demo-only readiness fixture — `GET /api/health`.
 * Reports which config GROUPS are present (booleans only, never values or
 * secrets). Available only when DEMO_MODE=true; not a production endpoint and
 * never touches pilot data. It exists so T0 can verify the app runs and later
 * tickets can confirm configuration without exposing anything sensitive.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  const status = serverEnvStatus();

  if (!status.demo_mode) {
    const body: ApiErrorBody = {
      error: {
        code: "NOT_FOUND",
        message: "Not found.",
      },
      request_id: requestId,
    };
    return NextResponse.json(body, {
      status: HTTP_STATUS_FOR_CODE.NOT_FOUND,
    });
  }

  const body: ApiSuccess<{
    demo: true;
    fixture: true;
    config: typeof status;
  }> = {
    data: { demo: true, fixture: true, config: status },
    request_id: requestId,
  };
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
