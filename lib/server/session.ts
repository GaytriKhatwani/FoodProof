import "server-only";
import type { DemoRole } from "@/lib/contracts";
import { notImplementedInT0 } from "./errors";

/**
 * Invitation/session boundary (FOODPROOF_TECHNICAL_SPEC.md §2).
 * Actor and role are resolved from stored records, never the request body.
 * T1 implements against the demo Supabase project; T0 freezes the shape.
 */

export interface ResolvedActor {
  accessId: string;
  role: DemoRole;
  label: string;
}

export interface SessionContext {
  actor: ResolvedActor;
  analytics: {
    consent: boolean;
    actorId: string | null;
    sessionId: string | null;
  };
}

export interface SessionCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAgeSeconds: number;
}

export interface SessionService {
  /** Exchange an invitation code for a session; returns actor summary + cookie. */
  createSession(
    invitationCode: string,
    addressHmac: string,
  ): Promise<{ actor: ResolvedActor; expiresAt: string; cookie: SessionCookie }>;
  /** Resolve the current session from the raw cookie token, or null. */
  resolveSession(rawToken: string): Promise<SessionContext | null>;
  /** Destroy the session and clear the cookie. */
  destroySession(rawToken: string): Promise<void>;
}

export const t0SessionService: SessionService = {
  createSession: () => notImplementedInT0("SessionService.createSession"),
  resolveSession: () => notImplementedInT0("SessionService.resolveSession"),
  destroySession: () => notImplementedInT0("SessionService.destroySession"),
};
