import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/errors";
import { parseServerEnv, serverEnvStatus } from "@/lib/server/env";
import {
  emailHmac,
  isModeratorEmailHmac,
  normaliseEmail,
  normaliseEmailOrNull,
  resetModeratorCache,
  roleForEmailHmac,
} from "@/lib/server/moderators";
import {
  EMAIL_SIGN_IN_MESSAGES,
  assertEmailSignInEnabled,
  requestEmailCode,
  verifiedAccountEmail,
  verifyEmailCode,
  type EmailSignInDeps,
} from "@/lib/server/auth-email";
import {
  EmailSignInRequest,
  EmailSignInVerifyRequest,
} from "@/lib/contracts";
import { invitationRateLimiter } from "@/lib/server/rate-limit";
import type { ResolvedActor, StartedSession } from "@/lib/server/session";

/**
 * Email sign-in with NO network and NO provider (phase two C.1). These
 * assertions are about OUR handling of an identity provider — that failures are
 * generic, that limits are counted before the provider is contacted, that the
 * role comes from configuration and never a request. They are never evidence
 * that the live provider works: that is tests/integration/auth-email.test.ts.
 */

const HMAC_KEY = "test-hmac-key-for-c1-unit-tests";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_ID = "22222222-2222-4222-8222-222222222222";
const ADDRESS_HMAC = "a".repeat(64);

const BASE_ENV = {
  SUPABASE_URL: "https://demo.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_x",
  MIXPANEL_TOKEN: "mp",
  MIXPANEL_API_HOST: "https://api-eu.mixpanel.com",
  APP_ORIGIN: "https://demo.example",
  RATE_LIMIT_HMAC_KEY: HMAC_KEY,
  DEMO_MODE: "true",
} as const;

/**
 * `getServerEnv()` memoises on first use, so the keying secret is pinned ONCE
 * for the whole file and restored afterwards. This also makes the suite run
 * identically on a fresh clone with no .env.local. The two values these tests
 * actually vary — the flag and the allowlist — are deliberately read live from
 * `process.env`, never from the memo (lib/server/env.ts).
 */
const ENV_KEYS = [
  ...(Object.keys(BASE_ENV) as (keyof typeof BASE_ENV)[]),
  "EMAIL_SIGN_IN",
  "SUPABASE_PUBLISHABLE_KEY",
  "MODERATOR_EMAILS",
] as const;
const originalEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ENV_KEYS) originalEnv.set(key, process.env[key]);
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value;
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
  delete process.env.EMAIL_SIGN_IN;
  delete process.env.MODERATOR_EMAILS;
});

afterAll(() => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetModeratorCache();
});

// ---------------------------------------------------------------------------
// Environment refinement
// ---------------------------------------------------------------------------
describe("server environment: EMAIL_SIGN_IN", () => {
  it("parses with the flag unset", () => {
    const env = parseServerEnv({ ...BASE_ENV } as unknown as NodeJS.ProcessEnv);
    expect(env.EMAIL_SIGN_IN).toBeUndefined();
  });

  it("treats an empty value as unset", () => {
    const env = parseServerEnv({
      ...BASE_ENV,
      EMAIL_SIGN_IN: "",
      MODERATOR_EMAILS: "",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.EMAIL_SIGN_IN).toBeUndefined();
    expect(env.MODERATOR_EMAILS).toBeUndefined();
  });

  it("rejects any value other than the literal 'true'", () => {
    expect(() =>
      parseServerEnv({ ...BASE_ENV, EMAIL_SIGN_IN: "yes" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/EMAIL_SIGN_IN/);
  });

  it("refuses EMAIL_SIGN_IN=true without a publishable key, naming the key", () => {
    expect(() =>
      parseServerEnv({ ...BASE_ENV, EMAIL_SIGN_IN: "true" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/SUPABASE_PUBLISHABLE_KEY/);
  });

  it("accepts EMAIL_SIGN_IN=true with a publishable key", () => {
    const env = parseServerEnv({
      ...BASE_ENV,
      EMAIL_SIGN_IN: "true",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.EMAIL_SIGN_IN).toBe("true");
  });
});

describe("serverEnvStatus().email_sign_in", () => {
  afterEach(() => {
    delete process.env.EMAIL_SIGN_IN;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
  });

  it("is false unless BOTH the flag and the key are present", () => {
    delete process.env.EMAIL_SIGN_IN;
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    expect(serverEnvStatus().email_sign_in).toBe(false);

    process.env.EMAIL_SIGN_IN = "true";
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    expect(serverEnvStatus().email_sign_in).toBe(false);

    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    expect(serverEnvStatus().email_sign_in).toBe(true);
  });

  it("reports booleans only, never a value", () => {
    process.env.EMAIL_SIGN_IN = "true";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_secret_value";
    const json = JSON.stringify(serverEnvStatus());
    expect(json).not.toContain("sb_publishable_secret_value");
  });
});

// ---------------------------------------------------------------------------
// Address normalisation, HMAC stability and the reviewer allowlist
// ---------------------------------------------------------------------------
describe("email normalisation and hashing", () => {
  it("trims and case-folds to one canonical form", () => {
    expect(normaliseEmail("  Tester@Example.Test \t")).toBe("tester@example.test");
    expect(normaliseEmail("TESTER@EXAMPLE.TEST")).toBe("tester@example.test");
  });

  it("rejects anything that is not an address", () => {
    for (const bad of ["", "   ", "not-an-email", "a@", "@b.test", "a b@c.test"]) {
      expect(() => normaliseEmail(bad)).toThrow();
      expect(normaliseEmailOrNull(bad)).toBeNull();
    }
    expect(normaliseEmailOrNull(null)).toBeNull();
    expect(normaliseEmailOrNull(undefined)).toBeNull();
  });

  it("produces the same HMAC for every spelling of one address", () => {
    const base = emailHmac("tester@example.test");
    expect(emailHmac(" TESTER@Example.TEST ")).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a different HMAC for a different address", () => {
    expect(emailHmac("a@example.test")).not.toBe(emailHmac("b@example.test"));
  });

  it("never contains the address itself", () => {
    expect(emailHmac("tester@example.test")).not.toContain("tester");
    expect(emailHmac("tester@example.test")).not.toContain("example");
  });

  it("is a KEYED hash: an attacker with the address alone cannot reproduce it", () => {
    const unkeyed = createHash("sha256")
      .update("email:tester@example.test")
      .digest("hex");
    expect(emailHmac("tester@example.test")).not.toBe(unkeyed);
  });

  it("uses a purpose prefix, so no originating address shares its bucket", () => {
    // `hashAddress` is fed raw addresses elsewhere; the prefix keeps the two
    // namespaces apart even for an address spelled like an email.
    expect(emailHmac("tester@example.test")).not.toBe(
      createHash("sha256").update("tester@example.test").digest("hex"),
    );
  });
});

describe("moderator allowlist", () => {
  beforeEach(() => {
    delete process.env.MODERATOR_EMAILS;
    resetModeratorCache();
  });
  afterEach(() => {
    delete process.env.MODERATOR_EMAILS;
    resetModeratorCache();
  });

  function setList(value: string | undefined) {
    if (value === undefined) delete process.env.MODERATOR_EMAILS;
    else process.env.MODERATOR_EMAILS = value;
    resetModeratorCache();
  }

  it("is empty when unset or blank, so nobody is a reviewer by default", () => {
    setList(undefined);
    expect(roleForEmailHmac(emailHmac("anyone@example.test"))).toBe("user");
    setList("");
    expect(roleForEmailHmac(emailHmac("anyone@example.test"))).toBe("user");
  });

  it("matches regardless of case and surrounding whitespace in the list", () => {
    setList("  Moderator@Example.TEST , other@example.test ");
    expect(isModeratorEmailHmac(emailHmac("moderator@example.test"))).toBe(true);
    expect(isModeratorEmailHmac(emailHmac("  MODERATOR@example.test  "))).toBe(true);
    expect(isModeratorEmailHmac(emailHmac("other@example.test"))).toBe(true);
  });

  it("does not match an address that is absent from the list", () => {
    setList("moderator@example.test");
    expect(roleForEmailHmac(emailHmac("someone-else@example.test"))).toBe("user");
    expect(roleForEmailHmac(emailHmac("moderator@example.test"))).toBe("reviewer");
  });

  it("ignores a malformed entry instead of failing the whole deployment", () => {
    setList("not-an-email,,moderator@example.test,   ");
    expect(roleForEmailHmac(emailHmac("moderator@example.test"))).toBe("reviewer");
    expect(isModeratorEmailHmac("not-an-email")).toBe(false);
  });

  it("treats a null or empty HMAC as not allowlisted", () => {
    setList("moderator@example.test");
    expect(isModeratorEmailHmac(null)).toBe(false);
    expect(isModeratorEmailHmac("")).toBe(false);
  });

  it("picks up a changed allowlist without a restart", () => {
    setList("moderator@example.test");
    const hmac = emailHmac("moderator@example.test");
    expect(roleForEmailHmac(hmac)).toBe("reviewer");
    // No resetModeratorCache(): the memo must notice the env value changed.
    process.env.MODERATOR_EMAILS = "someone-else@example.test";
    expect(roleForEmailHmac(hmac)).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------
describe("email sign-in request contracts", () => {
  it("accepts an address and trims it", () => {
    expect(EmailSignInRequest.parse({ email: "  a@b.test " })).toEqual({
      email: "a@b.test",
    });
  });

  it("rejects unknown fields, so no role or id can ride along", () => {
    expect(() =>
      EmailSignInRequest.parse({ email: "a@b.test", role: "reviewer" }),
    ).toThrow();
    expect(() =>
      EmailSignInVerifyRequest.parse({
        email: "a@b.test",
        code: "123456",
        access_id: ACCESS_ID,
      }),
    ).toThrow();
  });

  it("accepts six to eight digit codes only", () => {
    for (const code of ["123456", "1234567", "12345678"]) {
      expect(EmailSignInVerifyRequest.parse({ email: "a@b.test", code }).code).toBe(code);
    }
    for (const bad of ["12345", "123456789", "12345a", "", "  ", "123 456"]) {
      expect(() =>
        EmailSignInVerifyRequest.parse({ email: "a@b.test", code: bad }),
      ).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// requestEmailCode / verifyEmailCode with a faked provider
// ---------------------------------------------------------------------------
interface Fake {
  deps: EmailSignInDeps;
  sent: { email: string; shouldCreateUser?: boolean }[];
  verified: { email: string; token: string }[];
  revoked: string[];
  started: ResolvedActor[];
  mapped: { userId: string; hmac: string; role: string }[];
}

function fakeDeps(over?: {
  sendError?: { message: string };
  verifyError?: { message: string };
  user?: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
  } | null;
  session?: { access_token: string } | null;
}): Fake {
  const f: Fake = {
    sent: [],
    verified: [],
    revoked: [],
    started: [],
    mapped: [],
    deps: null as unknown as EmailSignInDeps,
  };
  const user =
    over?.user === undefined
      ? {
          id: USER_ID,
          email: "tester@example.test",
          email_confirmed_at: "2026-09-07T00:00:00.000Z",
        }
      : over.user;
  f.deps = {
    auth: {
      async signInWithOtp(credentials) {
        f.sent.push({
          email: credentials.email,
          shouldCreateUser: credentials.options?.shouldCreateUser,
        });
        return { error: over?.sendError ?? null };
      },
      async verifyOtp(params) {
        f.verified.push({ email: params.email, token: params.token });
        if (over?.verifyError) {
          return { data: { user: null, session: null }, error: over.verifyError };
        }
        return {
          data: {
            user,
            session:
              over?.session === undefined ? { access_token: "provider-token" } : over.session,
          },
          error: null,
        };
      },
    },
    async mapVerifiedActor(userId, hmac, role) {
      f.mapped.push({ userId, hmac, role });
      return { accessId: ACCESS_ID, label: "Verified account" };
    },
    async revokeProviderSession(token) {
      f.revoked.push(token);
    },
    async startSession(actor) {
      f.started.push(actor);
      return {
        actor,
        expiresAt: "2026-09-07T08:00:00.000Z",
        cookie: {
          name: "fp_session",
          value: "raw-session-token",
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAgeSeconds: 28_800,
        },
      } satisfies StartedSession;
    },
  };
  return f;
}

describe("email sign-in service", () => {
  let counted: string[] = [];
  let cleared: string[] = [];

  beforeEach(() => {
    process.env.EMAIL_SIGN_IN = "true";
    delete process.env.MODERATOR_EMAILS;
    resetModeratorCache();
    counted = [];
    cleared = [];
    // The limiter is Supabase-backed; the persistence itself is proven live in
    // tests/integration/hardening.test.ts. Here we assert only WHEN it is called.
    vi.spyOn(invitationRateLimiter, "recordFailedAttempt").mockImplementation(
      async (key: string) => {
        counted.push(key);
        return { allowed: true, retryAfterSeconds: 900 };
      },
    );
    vi.spyOn(invitationRateLimiter, "clear").mockImplementation(async (key: string) => {
      cleared.push(key);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.EMAIL_SIGN_IN;
    delete process.env.MODERATOR_EMAILS;
    resetModeratorCache();
  });

  async function caught(fn: () => Promise<unknown>): Promise<ApiError> {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    }
    throw new Error("expected the call to throw");
  }

  it("sends a code for the normalised address and reports only { requested: true }", async () => {
    const f = fakeDeps();
    const result = await requestEmailCode("  Tester@Example.TEST ", ADDRESS_HMAC, f.deps);
    expect(result).toEqual({ requested: true });
    expect(f.sent).toEqual([{ email: "tester@example.test", shouldCreateUser: true }]);
    // Nothing about the account, the code, or the provider leaks into the answer.
    expect(JSON.stringify(result)).toBe('{"requested":true}');
  });

  it("counts every send against both the address and the destination bucket", async () => {
    const f = fakeDeps();
    await requestEmailCode("tester@example.test", ADDRESS_HMAC, f.deps);
    expect(counted).toHaveLength(2);
    expect(new Set(counted).size).toBe(2);
    // A successful send never clears the counter: sending is what is capped.
    expect(cleared).toEqual([]);
  });

  it("counts the attempt BEFORE the provider is contacted", async () => {
    vi.mocked(invitationRateLimiter.recordFailedAttempt).mockImplementation(
      async (key: string) => {
        counted.push(key);
        return { allowed: false, retryAfterSeconds: 42 };
      },
    );
    const f = fakeDeps();
    const err = await caught(() =>
      requestEmailCode("tester@example.test", ADDRESS_HMAC, f.deps),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBe(42);
    expect(f.sent).toEqual([]);
  });

  it("turns a provider send failure into a generic 503", async () => {
    const f = fakeDeps({ sendError: { message: "SMTP relay refused: quota exceeded" } });
    const err = await caught(() =>
      requestEmailCode("tester@example.test", ADDRESS_HMAC, f.deps),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(err.message).toBe(EMAIL_SIGN_IN_MESSAGES.sendFailed);
    expect(err.message).not.toMatch(/SMTP|quota/i);
  });

  it("answers the same way whether or not the address has an account", async () => {
    const first = await requestEmailCode("known@example.test", ADDRESS_HMAC, fakeDeps().deps);
    const second = await requestEmailCode("unknown@example.test", ADDRESS_HMAC, fakeDeps().deps);
    expect(first).toEqual(second);
  });

  it("verifies a code, revokes the provider session and starts a FoodProof session", async () => {
    const f = fakeDeps();
    const started = await verifyEmailCode(
      " Tester@Example.TEST ",
      "123456",
      ADDRESS_HMAC,
      f.deps,
    );
    expect(f.verified).toEqual([{ email: "tester@example.test", token: "123456" }]);
    // The provider session is never used for anything.
    expect(f.revoked).toEqual(["provider-token"]);
    expect(started.actor.accessId).toBe(ACCESS_ID);
    expect(started.actor.authUserId).toBe(USER_ID);
    expect(started.actor.label).toBe("Verified account");
    // The address is never part of the actor a route can serialise.
    expect(JSON.stringify(started.actor)).not.toContain("tester@example.test");
  });

  it("maps a non-allowlisted address to the user role", async () => {
    const f = fakeDeps();
    const started = await verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps);
    expect(started.actor.role).toBe("user");
    expect(f.mapped[0]!.role).toBe("user");
  });

  it("maps an allowlisted address to the reviewer role", async () => {
    process.env.MODERATOR_EMAILS = " TESTER@example.test ";
    resetModeratorCache();
    const f = fakeDeps();
    const started = await verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps);
    expect(started.actor.role).toBe("reviewer");
    expect(f.mapped[0]!.role).toBe("reviewer");
  });

  it("passes the destination HMAC, never the address, to the actor mapping", async () => {
    const f = fakeDeps();
    await verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps);
    expect(f.mapped[0]!.hmac).toBe(emailHmac("tester@example.test"));
    expect(f.mapped[0]!.hmac).not.toContain("tester");
  });

  it("refuses an invalid or expired code with one generic message", async () => {
    const f = fakeDeps({ verifyError: { message: "Token has expired or is invalid" } });
    const err = await caught(() =>
      verifyEmailCode("tester@example.test", "999999", ADDRESS_HMAC, f.deps),
    );
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(err.message).toBe(EMAIL_SIGN_IN_MESSAGES.invalidCode);
    expect(f.started).toEqual([]);
  });

  it("refuses an unconfirmed account with the same generic message", async () => {
    const f = fakeDeps({
      user: { id: USER_ID, email: "tester@example.test", email_confirmed_at: null },
    });
    const err = await caught(() =>
      verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps),
    );
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(err.message).toBe(EMAIL_SIGN_IN_MESSAGES.invalidCode);
    expect(f.started).toEqual([]);
  });

  it("refuses when the verified address is not the submitted address", async () => {
    const f = fakeDeps({
      user: {
        id: USER_ID,
        email: "someone-else@example.test",
        email_confirmed_at: "2026-09-07T00:00:00.000Z",
      },
    });
    const err = await caught(() =>
      verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps),
    );
    expect(err.code).toBe("UNAUTHENTICATED");
    expect(f.mapped).toEqual([]);
    expect(f.started).toEqual([]);
  });

  it("still revokes the provider session when a later check refuses the sign-in", async () => {
    const f = fakeDeps({
      user: { id: USER_ID, email: "tester@example.test", email_confirmed_at: null },
    });
    await caught(() => verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, f.deps));
    expect(f.revoked).toEqual(["provider-token"]);
  });

  it("counts every verification attempt, and clears both buckets only on success", async () => {
    const f = fakeDeps({ verifyError: { message: "invalid" } });
    await caught(() => verifyEmailCode("tester@example.test", "000000", ADDRESS_HMAC, f.deps));
    expect(counted).toHaveLength(2);
    expect(cleared).toEqual([]);

    counted = [];
    await verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, fakeDeps().deps);
    expect(counted).toHaveLength(2);
    expect(cleared).toHaveLength(2);
    expect(new Set(cleared)).toEqual(new Set(counted));
  });

  it("uses different limiter buckets for sending and for verifying", async () => {
    await requestEmailCode("tester@example.test", ADDRESS_HMAC, fakeDeps().deps);
    const sendKeys = [...counted];
    counted = [];
    await verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, fakeDeps().deps);
    for (const key of counted) expect(sendKeys).not.toContain(key);
  });

  it("keys the destination bucket by the address, not by the caller", async () => {
    await requestEmailCode("one@example.test", ADDRESS_HMAC, fakeDeps().deps);
    const first = [...counted];
    counted = [];
    await requestEmailCode("two@example.test", ADDRESS_HMAC, fakeDeps().deps);
    // The address bucket is shared, the destination bucket is not.
    expect(counted.filter((k) => first.includes(k))).toHaveLength(1);
  });

  it("rejects a malformed address before the provider or the limiter is touched", async () => {
    const f = fakeDeps();
    await expect(
      requestEmailCode("not-an-email", ADDRESS_HMAC, f.deps),
    ).rejects.toThrow();
    expect(counted).toEqual([]);
    expect(f.sent).toEqual([]);
  });

  describe("with the flag off", () => {
    beforeEach(() => {
      delete process.env.EMAIL_SIGN_IN;
    });

    it("refuses both entry points with the same 'not enabled' 503", async () => {
      for (const call of [
        () => requestEmailCode("tester@example.test", ADDRESS_HMAC, fakeDeps().deps),
        () => verifyEmailCode("tester@example.test", "123456", ADDRESS_HMAC, fakeDeps().deps),
        async () => assertEmailSignInEnabled(),
      ]) {
        const err = await caught(call);
        expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
        expect(err.message).toBe(EMAIL_SIGN_IN_MESSAGES.disabled);
      }
    });

    it("contacts neither the provider nor the limiter", async () => {
      const f = fakeDeps();
      await caught(() => requestEmailCode("tester@example.test", ADDRESS_HMAC, f.deps));
      expect(f.sent).toEqual([]);
      expect(counted).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/me email lookup
// ---------------------------------------------------------------------------
describe("verifiedAccountEmail", () => {
  const invitationActor: Pick<ResolvedActor, "authUserId"> = { authUserId: null };
  const verifiedActor: Pick<ResolvedActor, "authUserId"> = { authUserId: USER_ID };

  it("returns null for an invitation actor without asking the provider", async () => {
    const lookup = vi.fn();
    const revoked = vi.fn(async () => undefined);
    await expect(
      verifiedAccountEmail(invitationActor, revoked, lookup),
    ).resolves.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(revoked).not.toHaveBeenCalled();
  });

  it("returns the normalised address for a live verified account", async () => {
    const revoked = vi.fn(async () => undefined);
    await expect(
      verifiedAccountEmail(verifiedActor, revoked, async () => ({
        email: "Tester@Example.TEST".toLowerCase(),
        emailConfirmed: true,
        bannedUntil: null,
      })),
    ).resolves.toBe("tester@example.test");
    expect(revoked).not.toHaveBeenCalled();
  });

  it("ends the session and refuses when the account is gone", async () => {
    const revoked = vi.fn(async () => undefined);
    await expect(
      verifiedAccountEmail(verifiedActor, revoked, async () => null),
    ).rejects.toBeInstanceOf(ApiError);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it("ends the session and refuses while the account is banned", async () => {
    const revoked = vi.fn(async () => undefined);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      verifiedAccountEmail(verifiedActor, revoked, async () => ({
        email: "tester@example.test",
        emailConfirmed: true,
        bannedUntil: future,
      })),
    ).rejects.toBeInstanceOf(ApiError);
    expect(revoked).toHaveBeenCalledOnce();
  });

  it("allows an account whose ban has already lapsed", async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    await expect(
      verifiedAccountEmail(verifiedActor, async () => undefined, async () => ({
        email: "tester@example.test",
        emailConfirmed: true,
        bannedUntil: past,
      })),
    ).resolves.toBe("tester@example.test");
  });

  it("refuses an account whose address is no longer confirmed", async () => {
    const revoked = vi.fn(async () => undefined);
    await expect(
      verifiedAccountEmail(verifiedActor, revoked, async () => ({
        email: "tester@example.test",
        emailConfirmed: false,
        bannedUntil: null,
      })),
    ).rejects.toBeInstanceOf(ApiError);
    expect(revoked).toHaveBeenCalledOnce();
  });
});
