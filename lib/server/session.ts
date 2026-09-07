import "server-only";
import type { DemoRole, SignInMethod } from "@/lib/contracts";
import { ApiError, MIGRATION_0006, mapMissingColumn } from "./errors";
import { emailSignInEnabled, getServerEnv } from "./env";
import { getServiceClient } from "./supabase";
import { generateToken, sha256Hex } from "./crypto";
import { invitationRateLimiter } from "./rate-limit";
import { roleForEmailHmac } from "./moderators";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Invitation/session boundary (FOODPROOF_TECHNICAL_SPEC.md §2).
 * Actor and role are resolved from stored records, never the request body.
 * Invitation codes and session tokens are compared by SHA-256 hash; raw values
 * are never stored. The invitation-attempt limiter is orchestrated here so the
 * response is identical whether a code is unknown, expired, revoked, or the
 * caller is over the rate limit — the boundary never reveals code validity.
 *
 * Phase two C.1 adds a SECOND kind of actor alongside the invitation actor: a
 * verified account (`demo_access.auth_user_id`, migration 0006). Sessions,
 * cookies, expiry, revocation and ownership work identically for both kinds —
 * only the way the actor row is first obtained differs
 * (lib/server/auth-email.ts). A verified account never claims an invitation
 * actor's content.
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
  /** The verified account behind this actor, or null for an invitation actor. */
  authUserId: string | null;
  /** Keyed HMAC of the verified address; null for an invitation actor. */
  emailHmac: string | null;
}

export interface StartedSession {
  actor: ResolvedActor;
  expiresAt: string;
  cookie: SessionCookie;
}

export interface SessionContext {
  actor: ResolvedActor;
  /** How this session was opened. Descriptive; it confers no authority. */
  signInMethod: SignInMethod;
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
  ): Promise<StartedSession>;
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

/** Actor columns every session read needs, whatever the identity kind. */
const ACTOR_COLUMNS = "id, role, label, expires_at, revoked_at";
/** Added by migration 0006; only selected where email sign-in is enabled. */
const VERIFIED_COLUMNS = `${ACTOR_COLUMNS}, auth_user_id, email_hmac`;

/**
 * A verified actor's row carries the extra columns; an invitation actor's row
 * may not have been selected with them at all (a deployment with email sign-in
 * off still runs against a pre-0006 schema).
 */
interface AccessRow {
  id: string;
  role: DemoRole;
  label: string;
  expires_at: string | null;
  revoked_at: string | null;
  auth_user_id?: string | null;
  email_hmac?: string | null;
}

/**
 * Whether migration 0006 is applied, as observed by the first actor read of
 * this process. `null` means "not yet observed".
 *
 * A deployment that switches `EMAIL_SIGN_IN` on BEFORE applying 0006 must not
 * take the invitation path down with it: session resolution is the one query
 * every request makes, so an ordering mistake by the operator would otherwise
 * lock every existing tester out. Instead the missing columns are reported once,
 * loudly, on the server log, invitation sessions keep resolving exactly as
 * before, and the email sign-in path stays refused (`verifiedAccountsReady()`
 * below, plus the loud `fp_verified_actor` error from lib/server/errors.ts).
 * This fallback can never hide a verified actor, because no verified actor can
 * exist while the column that identifies one does not.
 */
let verifiedColumns: boolean | null = null;

/** False only once a read has PROVED migration 0006 is missing. */
export function verifiedAccountsReady(): boolean {
  return verifiedColumns !== false;
}

/** Test seam: forget what the last read observed about migration 0006. */
export function resetVerifiedColumnProbe(): void {
  verifiedColumns = null;
}

/**
 * Read the actor row, asking for the migration-0006 columns only where email
 * sign-in is enabled and they have not already been proved absent.
 */
async function readActorRow(
  supabase: ReturnType<typeof getServiceClient>,
  accessId: string,
): Promise<AccessRow | null> {
  const wantVerified = emailSignInEnabled() && verifiedColumns !== false;
  const { data, error } = await supabase
    .from("demo_access")
    .select(wantVerified ? VERIFIED_COLUMNS : ACTOR_COLUMNS)
    .eq("id", accessId)
    .maybeSingle<AccessRow>();

  if (!error) {
    if (wantVerified) verifiedColumns = true;
    return data;
  }
  const missing =
    wantVerified &&
    mapMissingColumn("", error, MIGRATION_0006) instanceof ApiError;
  if (!missing) throw error;

  if (verifiedColumns !== false) {
    verifiedColumns = false;
    console.error(
      "[foodproof] EMAIL_SIGN_IN is on but demo_access has no verified-account " +
        `columns. Apply ${MIGRATION_0006} to this Supabase project. Email ` +
        "sign-in stays refused; invitation entry is unaffected.",
    );
  }
  const retry = await supabase
    .from("demo_access")
    .select(ACTOR_COLUMNS)
    .eq("id", accessId)
    .maybeSingle<AccessRow>();
  if (retry.error) throw retry.error;
  return retry.data;
}

function actorFrom(access: AccessRow): ResolvedActor {
  return {
    accessId: access.id,
    role: access.role,
    label: access.label,
    authUserId: access.auth_user_id ?? null,
    emailHmac: access.email_hmac ?? null,
  };
}

/**
 * Mint a session for an actor that has ALREADY been authorised — by an
 * invitation code here, or by a verified one-time code in
 * lib/server/auth-email.ts. One definition of the token, the TTL, the stored
 * hash and the cookie, so the two entry paths cannot drift apart.
 */
export async function startSession(actor: ResolvedActor): Promise<StartedSession> {
  const rawToken = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  const { error } = await getServiceClient().from("demo_sessions").insert({
    access_id: actor.accessId,
    token_hash: sha256Hex(rawToken),
    expires_at: expiresAt,
    analytics_consent: false,
  });
  if (error) throw error;
  return { actor, expiresAt, cookie: buildCookie(rawToken, SESSION_TTL_SECONDS) };
}

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

    // An invitation actor never has a verified account behind it, so the two
    // C.1 columns are not read here and this path still runs on a pre-0006
    // schema exactly as it did in phase one.
    return startSession({
      accessId: access.id,
      role: access.role,
      label: access.label,
      authUserId: null,
      emailHmac: null,
    });
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

    // The two C.1 columns exist only after migration 0006, so they are read
    // only where email sign-in is enabled — a deployment with the flag off runs
    // byte-for-byte the phase-one query.
    const access = await readActorRow(supabase, session.access_id);
    if (!access) return null;
    if (access.revoked_at) return null;
    if (access.expires_at && Date.parse(access.expires_at) <= now) return null;

    let actor = actorFrom(access);

    // A verified actor's role is deployment configuration, not stored state.
    // Recomputing it here (and writing it back when it differs) keeps the
    // database-side reviewer check in publication.ts agreeing with the
    // allowlist that is deployed right now: adding an address promotes on the
    // next request, removing one demotes on the next request, with no manual
    // database edit and no stale reviewer session.
    if (actor.authUserId) {
      const expected = roleForEmailHmac(actor.emailHmac);
      if (expected !== actor.role) {
        const { error: healErr } = await supabase
          .from("demo_access")
          .update({ role: expected })
          .eq("id", actor.accessId);
        if (healErr) throw healErr;
        actor = { ...actor, role: expected };
      }
    }

    return {
      actor,
      signInMethod: actor.authUserId ? "email" : "invitation",
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
