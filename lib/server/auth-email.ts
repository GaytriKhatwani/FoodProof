import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { DemoRole } from "@/lib/contracts";
import { ApiError, MIGRATION_0006, mapRpcError } from "./errors";
import { emailSignInEnabled, getServerEnv } from "./env";
import { getServiceClient } from "./supabase";
import { sha256Hex } from "./crypto";
import { invitationRateLimiter } from "./rate-limit";
import {
  emailHmac,
  normaliseEmail,
  normaliseEmailOrNull,
  roleForEmailHmac,
} from "./moderators";
import { startSession, type ResolvedActor, type StartedSession } from "./session";

/**
 * Email sign-in — phase two C.1 server slice (FOODPROOF_TECHNICAL_SPEC.md §2
 * "Phase two C.1", docs/FOODPROOF_DECISIONS.md D18).
 *
 * A one-time code sent to an address the person controls proves the address; the
 * proof is then exchanged HERE for the same kind of FoodProof session an
 * invitation code produces. The two entry paths run side by side: invitation
 * entry is untouched, and a verified account never claims an invitation actor's
 * reports, evidence or publications.
 *
 * Boundaries this module holds.
 *
 *  - The provider is contacted through a PER-REQUEST client built from the
 *    publishable key. The service client (which bypasses RLS) never performs a
 *    sign-in, and a user's provider token never touches it.
 *  - The provider session created by verification is revoked immediately and is
 *    never used for anything: FoodProof's own session cookie is the only
 *    credential that leaves this server, and the browser never receives a
 *    provider token, the publishable key, or the one-time code.
 *  - Rate limits are applied BEFORE the provider is contacted, on two
 *    independent buckets — the originating address and the destination address —
 *    so neither a single caller nor a single mailbox can be flooded.
 *  - Every failure to sign in produces ONE generic message. Nothing here reveals
 *    whether an address has an account, whether a code was ever issued, or why a
 *    code was refused.
 *  - The role of a verified account comes from the `MODERATOR_EMAILS`
 *    allowlist (lib/server/moderators.ts), never from the request.
 */

const DISABLED_MESSAGE = "Email sign-in is not enabled.";
const RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please wait and try again.";
const SEND_FAILED_MESSAGE = "Could not send a sign-in code right now. Please try again shortly.";
const GENERIC_INVALID_CODE = "That code is not valid. Request a new code and try again.";

/** The two limiter buckets, per action. Distinct namespaces, one definition. */
type LimitAction = "request" | "verify";
const addressBucket = (action: LimitAction, addressHmac: string) =>
  sha256Hex(`email-${action}:addr:${addressHmac}`);
const destinationBucket = (action: LimitAction, destinationHmac: string) =>
  sha256Hex(`email-${action}:dest:${destinationHmac}`);

/** The provider surface this module uses. Narrow on purpose, so it can be faked. */
export interface EmailAuthClient {
  signInWithOtp(credentials: {
    email: string;
    options?: { shouldCreateUser?: boolean };
  }): Promise<{ error: { message?: string } | null }>;
  verifyOtp(params: { email: string; token: string; type: "email" }): Promise<{
    data: {
      user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
      session: { access_token: string } | null;
    };
    error: { message?: string } | null;
  }>;
}

export interface EmailSignInDeps {
  /** Per-request provider client (publishable key). */
  auth: EmailAuthClient;
  /** Map a verified account onto an actor row; returns the actor's access id. */
  mapVerifiedActor: (
    userId: string,
    hmac: string,
    role: DemoRole,
  ) => Promise<{ accessId: string; label: string }>;
  /** Best-effort revocation of the provider session we will never use. */
  revokeProviderSession: (accessToken: string) => Promise<void>;
  /** Mint the FoodProof session cookie for an authorised actor. */
  startSession: (actor: ResolvedActor) => Promise<StartedSession>;
}

/**
 * Refuse both endpoints when the deployment has not enabled email sign-in. The
 * message is the same one the routes advertise, so an unset flag reads as
 * "this deployment does not offer it", never as "your address is wrong".
 */
export function assertEmailSignInEnabled(): void {
  if (!emailSignInEnabled()) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", DISABLED_MESSAGE);
  }
}

/**
 * A fresh client per call, holding only the publishable key. No session is
 * persisted, no token is refreshed, no URL is inspected for a session, and (as
 * in lib/server/supabase.ts) every fetch opts out of the Next.js Data Cache so a
 * verification can never be served from a cached response.
 */
export function createEmailAuthClient(): EmailAuthClient {
  const env = getServerEnv();
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY as string, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return client.auth as unknown as EmailAuthClient;
}

/** Upsert the actor row for a verified account through the 0006 function. */
async function mapVerifiedActor(
  userId: string,
  hmac: string,
  role: DemoRole,
): Promise<{ accessId: string; label: string }> {
  const { data, error } = await getServiceClient().rpc("fp_verified_actor", {
    p_user_id: userId,
    p_email_hmac: hmac,
    p_role: role,
  });
  if (error) throw mapRpcError("fp_verified_actor", error, MIGRATION_0006);
  if (typeof data !== "string" || !data) {
    throw new ApiError(
      "DEPENDENCY_UNAVAILABLE",
      "Could not open your account right now. Please try again shortly.",
    );
  }
  // The label is fixed by the migration; the address never enters this table.
  return { accessId: data, label: "Verified account" };
}

/** Revoke the provider session immediately; a failure here is never fatal. */
async function revokeProviderSession(accessToken: string): Promise<void> {
  try {
    await getServiceClient().auth.admin.signOut(accessToken, "global");
  } catch {
    // The token is already unused and short lived; nothing depends on this.
  }
}

function defaultDeps(): EmailSignInDeps {
  return {
    auth: createEmailAuthClient(),
    mapVerifiedActor,
    revokeProviderSession,
    startSession,
  };
}

/**
 * Count one attempt on BOTH buckets and refuse when either is over the window
 * limit. Every request counts, including a successful one: the send endpoint has
 * no notion of failure a caller could avoid, so counting only failures would
 * leave it uncapped. Uses the existing persistent limiter (five per 15 minutes,
 * multi-instance safe) rather than a second mechanism.
 */
async function countAttempt(
  action: LimitAction,
  addressHmac: string,
  destinationHmac: string,
): Promise<void> {
  for (const key of [
    addressBucket(action, addressHmac),
    destinationBucket(action, destinationHmac),
  ]) {
    const result = await invitationRateLimiter.recordFailedAttempt(key);
    if (!result.allowed) {
      throw new ApiError("RATE_LIMITED", RATE_LIMITED_MESSAGE, {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }
}

async function clearAttempts(
  action: LimitAction,
  addressHmac: string,
  destinationHmac: string,
): Promise<void> {
  await invitationRateLimiter.clear(addressBucket(action, addressHmac));
  await invitationRateLimiter.clear(destinationBucket(action, destinationHmac));
}

/**
 * Ask the provider to send a one-time code. The answer is `{ requested: true }`
 * whether or not the address already has an account, so this endpoint can never
 * be used to test whether someone is a FoodProof user. A provider failure is one
 * generic 503; its message and status never reach the client.
 */
export async function requestEmailCode(
  email: string,
  addressHmac: string,
  deps?: EmailSignInDeps,
): Promise<{ requested: true }> {
  assertEmailSignInEnabled();
  const normalised = normaliseEmail(email);
  const destinationHmac = emailHmac(normalised);

  // Limit FIRST: the provider is not contacted at all by a capped caller.
  await countAttempt("request", addressHmac, destinationHmac);

  const client = (deps ?? defaultDeps()).auth;
  const { error } = await client.signInWithOtp({
    email: normalised,
    options: { shouldCreateUser: true },
  });
  if (error) {
    console.error("[foodproof] email sign-in code request failed");
    throw new ApiError("DEPENDENCY_UNAVAILABLE", SEND_FAILED_MESSAGE);
  }
  return { requested: true };
}

/**
 * Exchange a one-time code for a FoodProof session. Every refusal — a wrong
 * code, an expired code, an unconfirmed account, an address that does not match
 * the code — is the same `UNAUTHENTICATED` message, so a caller learns nothing
 * from the difference.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  addressHmac: string,
  deps?: EmailSignInDeps,
): Promise<StartedSession> {
  assertEmailSignInEnabled();
  const normalised = normaliseEmail(email);
  const destinationHmac = emailHmac(normalised);
  const d = deps ?? defaultDeps();

  // Every guess counts, before the provider sees it.
  await countAttempt("verify", addressHmac, destinationHmac);

  const { data, error } = await d.auth.verifyOtp({
    email: normalised,
    token: code,
    type: "email",
  });

  // The provider session is never used for anything: revoke it as soon as it
  // exists, whether or not the checks below pass.
  if (data?.session?.access_token) {
    await d.revokeProviderSession(data.session.access_token);
  }

  const user = data?.user ?? null;
  const verifiedAddress = user?.email ? user.email.trim().toLowerCase() : null;
  const proved =
    !error &&
    user &&
    Boolean(user.email_confirmed_at) &&
    verifiedAddress === normalised;
  if (!proved) {
    throw new ApiError("UNAUTHENTICATED", GENERIC_INVALID_CODE);
  }

  // Authority is deployment configuration, never the request body.
  const role = roleForEmailHmac(destinationHmac);
  const { accessId, label } = await d.mapVerifiedActor(user.id, destinationHmac, role);

  const started = await d.startSession({
    accessId,
    role,
    label,
    authUserId: user.id,
    emailHmac: destinationHmac,
  });

  // Only a completed sign-in clears the counters.
  await clearAttempts("verify", addressHmac, destinationHmac);
  return started;
}

/**
 * The address behind a verified actor, for `GET /api/me` only. Null for an
 * invitation actor, which has no address anywhere in the system.
 *
 * An account the provider no longer accepts — deleted, or banned right now —
 * must stop working immediately even though the FoodProof session cookie has not
 * expired. `onRevoked` ends that session before this throws UNAUTHENTICATED, so
 * the very next request has nothing to resolve.
 */
export async function verifiedAccountEmail(
  actor: Pick<ResolvedActor, "authUserId">,
  onRevoked: () => Promise<void>,
  lookup?: (userId: string) => Promise<VerifiedAccountLookup | null>,
): Promise<string | null> {
  if (!actor.authUserId) return null;
  const account = await (lookup ?? lookupVerifiedAccount)(actor.authUserId);
  const banned = account?.bannedUntil
    ? Date.parse(account.bannedUntil) > Date.now()
    : false;
  if (!account || !account.emailConfirmed || banned) {
    await onRevoked();
    throw new ApiError("UNAUTHENTICATED", "Sign in to continue.");
  }
  return account.email;
}

export interface VerifiedAccountLookup {
  email: string | null;
  emailConfirmed: boolean;
  bannedUntil: string | null;
}

/** Read the account from the provider. The service client is the admin caller. */
async function lookupVerifiedAccount(
  userId: string,
): Promise<VerifiedAccountLookup | null> {
  const { data, error } = await getServiceClient().auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  const user = data.user as {
    email?: string | null;
    email_confirmed_at?: string | null;
    banned_until?: string | null;
  };
  return {
    email: normaliseEmailOrNull(user.email),
    emailConfirmed: Boolean(user.email_confirmed_at),
    bannedUntil: user.banned_until ?? null,
  };
}

/** Exported for the routes and for tests that assert the exact wording. */
export const EMAIL_SIGN_IN_MESSAGES = {
  disabled: DISABLED_MESSAGE,
  rateLimited: RATE_LIMITED_MESSAGE,
  sendFailed: SEND_FAILED_MESSAGE,
  invalidCode: GENERIC_INVALID_CODE,
} as const;
