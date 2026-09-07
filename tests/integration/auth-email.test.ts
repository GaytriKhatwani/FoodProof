import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { ApiError } from "@/lib/server/errors";
import { emailHmac } from "@/lib/server/moderators";
import { requestEmailCode, verifyEmailCode } from "@/lib/server/auth-email";
import { sessionService } from "@/lib/server/session";
import { createReport } from "@/lib/server/reports";
import { listOwnReports } from "@/lib/server/data";
import {
  createAccess,
  deleteAccess,
  deleteAttempts,
  deleteAuthUsers,
  liveSuite,
  publishableKey,
  randomAddressHmac,
  testClient,
} from "../helpers/live";

/**
 * Email sign-in against the LIVE demo Supabase project (phase two C.1,
 * supabase/migrations/0006_verified_accounts.sql).
 *
 * HOW A CODE IS OBTAINED WITHOUT SENDING EMAIL.
 *   `auth.admin.generateLink({ type: "magiclink" })` creates (or finds) the
 *   account and returns `properties.email_otp` — the very code the email would
 *   have carried — without delivering anything. `verifyEmailCode` then goes
 *   through the ordinary published path: the same per-request publishable-key
 *   client, the same checks, the same session insert. Nothing here is a
 *   test-only shortcut through the boundary being tested.
 *
 * WHAT IS NOT COVERED HERE, AND WHY.
 *   The SEND half (`signInWithOtp`) cannot be exercised end to end without a
 *   configured SMTP relay and a real mailbox: Supabase rejects reserved test
 *   domains outright, and its built-in relay only delivers to project team
 *   members. One assertion below proves the honest failure mapping; the rest of
 *   the send path is unit tested with a faked provider in
 *   tests/unit/auth-email.test.ts.
 *
 * This suite reports BLOCKED (skipped, never passed) until 0006 is applied and
 * EMAIL_SIGN_IN / SUPABASE_PUBLISHABLE_KEY are set.
 */
const suite = await liveSuite("email sign-in (live Supabase)", {
  requires: {
    met: process.env.EMAIL_SIGN_IN === "true" && Boolean(publishableKey),
    reason:
      "EMAIL_SIGN_IN=true and SUPABASE_PUBLISHABLE_KEY are required for the email sign-in path",
  },
  requiresSchema: 6,
});

suite.run(suite.title, () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdAuthUsers: string[] = [];
  const createdHmacs: string[] = [];
  const savedModerators = process.env.MODERATOR_EMAILS;

  afterAll(async () => {
    if (savedModerators === undefined) delete process.env.MODERATOR_EMAILS;
    else process.env.MODERATOR_EMAILS = savedModerators;
    // Child -> parent, then the auth accounts last: the FK is ON DELETE
    // RESTRICT, so an account cannot go while an actor row still points at it.
    await deleteAccess(client, createdAccess);
    await deleteAuthUsers(client, createdAuthUsers);
    await deleteAttempts(client, createdHmacs);
  });

  /** A fresh fictional address on a reserved domain that never receives mail. */
  const newAddress = () => `c1-${randomUUID().slice(0, 12)}@example.test`;

  function newAddressHmac(): string {
    const hmac = randomAddressHmac();
    createdHmacs.push(hmac);
    return hmac;
  }

  /**
   * Create/find the account and return the code the email would have carried.
   * `email_otp` is the documented property; if a project ever stops returning
   * it, this fails loudly rather than skipping the assertions silently.
   */
  async function issueCode(email: string): Promise<string> {
    const { data, error } = await client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) throw new Error(`generateLink failed: ${error.message}`);
    const userId = data.user?.id;
    if (userId && !createdAuthUsers.includes(userId)) createdAuthUsers.push(userId);
    const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
    expect(
      otp,
      "auth.admin.generateLink must return properties.email_otp for this project",
    ).toBeTruthy();
    return otp as string;
  }

  function trackActor(accessId: string) {
    if (!createdAccess.includes(accessId)) createdAccess.push(accessId);
  }

  it("creates a verified actor with the user role and a resolvable session", async () => {
    const email = newAddress();
    const code = await issueCode(email);
    const started = await verifyEmailCode(email, code, newAddressHmac());
    trackActor(started.actor.accessId);

    expect(started.actor.role).toBe("user");
    expect(started.actor.label).toBe("Verified account");
    expect(started.actor.authUserId).toBeTruthy();
    expect(started.actor.emailHmac).toBe(emailHmac(email));
    expect(started.cookie.httpOnly).toBe(true);
    expect(Date.parse(started.expiresAt)).toBeGreaterThan(Date.now());

    const ctx = await sessionService.resolveSession(started.cookie.value);
    expect(ctx?.actor.accessId).toBe(started.actor.accessId);
    expect(ctx?.signInMethod).toBe("email");
    expect(ctx?.actor.role).toBe("user");

    // The address must not be readable from any application table.
    const { data: row } = await client
      .from("demo_access")
      .select("label, email_hmac, token_hash, auth_user_id")
      .eq("id", started.actor.accessId)
      .single();
    expect(row!.label).toBe("Verified account");
    expect(row!.token_hash).toBeNull();
    expect(row!.email_hmac).toBe(emailHmac(email));
    expect(JSON.stringify(row)).not.toContain(email.split("@")[0]);
  });

  it("returns the SAME actor for a second sign-in, never a duplicate", async () => {
    const email = newAddress();
    const first = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(first.actor.accessId);
    const second = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(second.actor.accessId);

    expect(second.actor.accessId).toBe(first.actor.accessId);
    expect(second.actor.authUserId).toBe(first.actor.authUserId);
    // Two sessions, one actor: the cookies differ, the ownership does not.
    expect(second.cookie.value).not.toBe(first.cookie.value);

    const { count } = await client
      .from("demo_access")
      .select("id", { count: "exact", head: true })
      .eq("auth_user_id", first.actor.authUserId as string);
    expect(count).toBe(1);
  });

  it("gives an allowlisted address the reviewer role, and demotes it when removed", async () => {
    const email = newAddress();
    process.env.MODERATOR_EMAILS = ` ${email.toUpperCase()} `;
    const started = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(started.actor.accessId);
    expect(started.actor.role).toBe("reviewer");

    const stored = await client
      .from("demo_access")
      .select("role")
      .eq("id", started.actor.accessId)
      .single();
    expect(stored.data!.role).toBe("reviewer");

    // Removing the address demotes on the very next request, with no manual
    // database edit, so the database-side reviewer check agrees with the
    // allowlist that is deployed right now.
    delete process.env.MODERATOR_EMAILS;
    const ctx = await sessionService.resolveSession(started.cookie.value);
    expect(ctx?.actor.role).toBe("user");

    const healed = await client
      .from("demo_access")
      .select("role")
      .eq("id", started.actor.accessId)
      .single();
    expect(healed.data!.role).toBe("user");
  });

  it("keeps a verified actor's reports invisible to an invitation actor and back", async () => {
    const email = newAddress();
    const verified = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(verified.actor.accessId);

    const invited = await createAccess(client, {
      role: "user",
      label: "c1-isolation@foodproof",
    });
    createdAccess.push(invited.accessId);

    const mine = await createReport(
      verified.actor.accessId,
      {
        product_name: "Verified Account Crackers",
        brand: "Sample Pantry",
        variant: null,
        concern_text: "Synthetic isolation fixture.",
        claim_text: null,
        ingredients_text: null,
        expected_version: null,
      },
      randomUUID(),
    );

    const theirs = await listOwnReports(invited.accessId, null);
    expect(theirs.items.map((r) => r.report_id)).not.toContain(mine.report_id);

    const ours = await listOwnReports(verified.actor.accessId, null);
    expect(ours.items.map((r) => r.report_id)).toContain(mine.report_id);
  });

  it("leaves invitation entry working exactly as before", async () => {
    const invited = await createAccess(client, {
      role: "user",
      label: "c1-invitation@foodproof",
    });
    createdAccess.push(invited.accessId);

    const started = await sessionService.createSession(invited.code, newAddressHmac());
    expect(started.actor.accessId).toBe(invited.accessId);
    expect(started.actor.authUserId).toBeNull();
    expect(started.actor.emailHmac).toBeNull();

    const ctx = await sessionService.resolveSession(started.cookie.value);
    expect(ctx?.signInMethod).toBe("invitation");
    expect(ctx?.actor.label).toBe("c1-invitation@foodproof");

    // Logout is the same endpoint for both kinds of session.
    await sessionService.destroySession(started.cookie.value);
    expect(await sessionService.resolveSession(started.cookie.value)).toBeNull();
  });

  it("ends a verified session on logout", async () => {
    const email = newAddress();
    const started = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(started.actor.accessId);
    await sessionService.destroySession(started.cookie.value);
    expect(await sessionService.resolveSession(started.cookie.value)).toBeNull();
  });

  it("refuses a wrong code with one generic message and starts no session", async () => {
    const email = newAddress();
    await issueCode(email);
    let caught: unknown;
    try {
      await verifyEmailCode(email, "000000", newAddressHmac());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("UNAUTHENTICATED");
    // Nothing about the account or the real code is disclosed.
    expect((caught as ApiError).message).not.toContain(email);
  });

  it("refuses a revoked verified actor, the same way a revoked invitation is refused", async () => {
    const email = newAddress();
    const started = await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    trackActor(started.actor.accessId);

    const { error } = await client
      .from("demo_access")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", started.actor.accessId);
    expect(error).toBeNull();

    // The existing session stops resolving...
    expect(await sessionService.resolveSession(started.cookie.value)).toBeNull();

    // ...and signing in again cannot resurrect it.
    let caught: unknown;
    try {
      await verifyEmailCode(email, await issueCode(email), newAddressHmac());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("FORBIDDEN");

    // Undo so the shared afterAll cleanup can delete the row normally.
    await client
      .from("demo_access")
      .update({ revoked_at: null })
      .eq("id", started.actor.accessId);
  });

  it("maps a provider refusal of the send call to a generic 503", async () => {
    // A reserved test domain is refused by the provider before any mail is
    // attempted, which is exactly the failure shape this asserts: the provider's
    // own message never reaches the caller.
    let caught: unknown;
    try {
      await requestEmailCode(newAddress(), newAddressHmac());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).code).toBe("DEPENDENCY_UNAVAILABLE");
    expect((caught as ApiError).message).not.toMatch(/invalid|supabase|smtp/i);
  });
});
