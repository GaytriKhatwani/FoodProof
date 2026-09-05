import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Pilot entry gate (FOODPROOF_TECHNICAL_SPEC.md §2). Guards `/pilot/*`
 * subpaths (never `/pilot` itself, and never `/api/**`) so an unauthenticated
 * visitor cannot even reach the pilot shell's client code. This is a coarse
 * presence check only — it does NOT validate the cookie's token; every API
 * call still validates the session server-side on every request
 * (`lib/server/context.ts` `requireSession`). Dependency-free by design (no
 * Supabase, no server-only imports) so it can run on the Edge runtime.
 */
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (hasSession) return NextResponse.next();

  const next = req.nextUrl.pathname;
  const url = req.nextUrl.clone();
  url.pathname = "/pilot";
  // Only ever echo a `next` value that stays within the pilot section.
  url.search = next.startsWith("/pilot/") ? `?next=${encodeURIComponent(next)}` : "";

  const res = NextResponse.redirect(url, 307);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  matcher: ["/pilot/:path+"],
};
