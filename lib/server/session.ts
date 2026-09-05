import "server-only";
import type { DemoRole } from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServerEnv } from "./env";
import { getServiceClient } from "./supabase";
import { generateToken, sha256Hex } from "./crypto";
import { invitationRateLimiter } from "./rate-limit";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Invitation/session boundary (FOODPROOF_TECHNICAL_SPEC.md §2).
 * Actor and role are resolved from stored records, never the request body.
 * Invitation codes and session tokens are compared by SHA-256 hash; raw values
 * are never stored. The invitation-attempt limiter is orchestrated here so the
 * response is identical whether a code is unknown, expired, revoked, or the
 * caller is over the rate limit — the boundary never reveals code validity.
 */

// Single source of truth for the cookie name lives in lib/session-cookie.ts
// (dependency-free, so the edge middleware can import it too); re-exported
// here so existing importers of `SESSION_COOKIE` from this module still work.
export { SESSION_COOKIE };
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours (demo default)

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
  createSession(
    invitationCode: string,
    addressHmac: string,
  ): Promise<{ actor: ResolvedActor; expiresAt: string; cookie: SessionCookie }>;
  resolveSession(rawToken: string): Promise<SessionContext | null>;
  destroySession(rawToken: string): Promise<void>;
}

function deploySecure(): boolean {
  return getServerEnv().APP_ORIGIN.startsWith("https://");
}

function buildCookie(value: string, maxAgeSeconds: number): SessionCookie {
  return {
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    secure: deploySecure(),
    sameSite: "lax",
    maxAgeSeconds,
  };
}

/** Cookie attributes that clear the session cookie on logout. */
export function clearedCookie(): SessionCookie {
  return buildCookie("", 0);
}

const GENERIC_INVALID = "Invalid invitation code.";
const RATE_LIMITED_MESSAGE =
  "Too many invitation attempts. Please wait and try again.";

export const sessionService: SessionService = {
  async createSession(invitationCode, addressHmac) {
    // Read-only gate first: a blocked caller is rejected before the code is
    // inspected, so being over the limit reveals nothing about code validity.
    const gate = await invitationRateLimiter.check(addressHmac);
    if (!gate.allowed) {
      throw new ApiError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
        retryAfterSeconds: gate.retryAfterSeconds,
      });
    }

    const supabase = getServiceClient();
    const { data: access, error } = await supabase
      .from("demo_access")
      .select("id, role, label, expires_at, revoked_at")
      .eq("token_hash", sha256Hex(invitationCode))
      .maybeSingle();
    if (error) throw error;

    const now = Date.now();
    const valid =
      access &&
      !access.revoked_at &&
      (!access.expires_at || Date.parse(access.expires_at) > now);

    if (!valid) {
      const r = await invitationRateLimiter.recordFailedAttempt(addressHmac);
      if (!r.allowed) {
        throw new ApiError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
          retryAfterSeconds: r.retryAfterSeconds,
        });
      }
      throw new ApiError("UNAUTHENTICATED", GENERIC_INVALID);
    }

    // Successful entry clears the current failed-attempt counter.
    await invitationRateLimiter.clear(addressHmac);

    const rawToken = generateToken();
    const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();
    const { error: insErr } = await supabase.from("demo_sessions").insert({
      access_id: access.id,
      token_hash: sha256Hex(rawToken),
      expires_at: expiresAt,
      analytics_consent: false,
    });
    if (insErr) throw insErr;

    return {
      actor: { accessId: access.id, role: access.role, label: access.label },
      expiresAt,
      cookie: buildCookie(rawToken, SESSION_TTL_SECONDS),
    };
  },

  async resolveSession(rawToken) {
    if (!rawToken) return null;
    const supabase = getServiceClient();
    const { data: session, error } = await supabase
      .from("demo_sessions")
      .select(
        "id, access_id, expires_at, analytics_consent, analytics_actor_id, analytics_session_id",
      )
      .eq("token_hash", sha256Hex(rawToken))
      .maybeSingle();
    if (error) throw error;
    if (!session) return null;

    const now = Date.now();
    if (Date.parse(session.expires_at) <= now) return null;

    const { data: access, error: accErr } = await supabase
      .from("demo_access")
      .select("id, role, label, expires_at, revoked_at")
      .eq("id", session.access_id)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!access) return null;
    if (access.revoked_at) return null;
    if (access.expires_at && Date.parse(access.expires_at) <= now) return null;

    return {
      actor: { accessId: access.id, role: access.role, label: access.label },
      analytics: {
        consent: session.analytics_consent,
        actorId: session.analytics_actor_id,
        sessionId: session.analytics_session_id,
      },
    };
  },

  async destroySession(rawToken) {
    if (!rawToken) return;
    const supabase = getServiceClient();
    const { error } = await supabase
      .from("demo_sessions")
      .delete()
      .eq("token_hash", sha256Hex(rawToken));
    if (error) throw error;
  },
};

/**
 * Set or clear analytics consent on the current session. Random analytics
 * identifiers are minted only on allow and cleared on decline; the server owns
 * these ids and the client can never set them. Analytics is never required for
 * use (FOODPROOF_TECHNICAL_SPEC.md §6/§9).
 */
export async function setAnalyticsConsent(
  rawToken: string,
  allowed: boolean,
): Promise<{ consent: boolean }> {
  const supabase = getServiceClient();
  const patch = allowed
    ? {
        analytics_consent: true,
        analytics_actor_id: crypto.randomUUID(),
        analytics_session_id: crypto.randomUUID(),
      }
    : {
        analytics_consent: false,
        analytics_actor_id: null,
        analytics_session_id: null,
      };
  const { error } = await supabase
    .from("demo_sessions")
    .update(patch)
    .eq("token_hash", sha256Hex(rawToken));
  if (error) throw error;
  return { consent: allowed };
}
