import { randomUUID } from "node:crypto";
import { test, expect, type Page, type Route } from "@playwright/test";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { E2E_ORIGIN } from "./origin";
import {
  deleteAuthUsers,
  deleteInvitations,
  findVerifiedAccessId,
  liveClient,
  missingLiveCredential,
  schemaVersion,
} from "./helpers";

/**
 * Email sign-in (phase two C.1, docs/FOODPROOF_TECHNICAL_SPEC.md §2 "Phase
 * two C.1", FOODPROOF_API_DETAILS.md). This worktree's `.env.local` sets
 * `EMAIL_SIGN_IN=true`, so `/pilot` renders both paths.
 *
 * Every scenario except the last mocks the two new endpoints with
 * `page.route`, so no email is ever sent. A mocked `verify` cannot set a real
 * session cookie, so the happy-path spec adds a coarse session cookie itself
 * (the same technique `entry-session.spec.ts` uses for "a session that ends
 * mid-visit") and mocks `GET /api/me` to answer as the verified session that
 * a real `verify` would have produced — the middleware only checks the
 * cookie's PRESENCE (`middleware.ts`), never its validity.
 */

function emailErrorEnvelope(code: string, message: string, requestId = randomUUID()) {
  return { error: { code, message }, request_id: requestId };
}

function emailSuccessEnvelope<T>(data: T, requestId = randomUUID()) {
  return { data, request_id: requestId };
}

async function addFakeSessionCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: "e2e-mocked-email-session",
      domain: new URL(page.url()).hostname,
      path: "/",
    },
  ]);
}

async function mockRequestEndpoint(page: Page): Promise<void> {
  await page.route("**/api/auth/email/request", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(emailSuccessEnvelope({ requested: true })),
    });
  });
}

async function fillAndSendCode(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(`We sent a code to`)).toBeVisible();
}

test.describe("email sign-in entry", () => {
  test("flag on: both sign-in paths render with their own explanation", async ({ page }) => {
    await page.goto("/pilot");

    await expect(page.getByRole("heading", { level: 1, name: "FoodProof pilot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in with your email" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Have an invitation code?" })).toBeVisible();

    await expect(
      page.getByText(/creates or reuses an account tied to that address/),
    ).toBeVisible();

    // Both forms coexist; neither replaces the other.
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send code" })).toBeVisible();
    await expect(page.getByLabel("Invitation code")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter demo" })).toBeVisible();

    // Phase one's "no login flow" assertions still hold for the email path too.
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
  });

  test("happy path: request, verify and the shell shows the email and sign-in method", async ({
    page,
  }) => {
    const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;

    await page.goto("/pilot");
    await addFakeSessionCookie(page);
    await mockRequestEndpoint(page);

    await page.route("**/api/auth/email/verify", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          emailSuccessEnvelope({
            label: "Verified account",
            role: "user",
            expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
          }),
        ),
      });
    });
    await page.route("**/api/me/analytics-consent", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(emailSuccessEnvelope({ analytics_consent: false })),
      });
    });
    await page.route("**/api/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          emailSuccessEnvelope({
            label: "Verified account",
            role: "user",
            analytics_consent: false,
            ai_available: false,
            official_portal: null,
            sign_in_method: "email",
            email,
          }),
        ),
      });
    });

    await fillAndSendCode(page, email);

    await page.getByLabel("One-time code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Usage analytics" })).toBeVisible();
    await page.getByRole("button", { name: "Continue without analytics" }).click();

    await expect(page).toHaveURL(/\/pilot\/feed$/);

    const header = page.getByRole("banner");
    await expect(header).toContainText(email);
    await expect(header).toContainText("Signed in with email");
    // A verified user's role still governs the nav, exactly as an invitation's does.
    const nav = page.getByRole("navigation", { name: "Pilot" });
    await expect(nav.getByRole("link", { name: "Review" })).toHaveCount(0);
  });

  test("an invalid code shows one generic message and stays on the code step", async ({ page }) => {
    const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;

    await page.goto("/pilot");
    await mockRequestEndpoint(page);
    await page.route("**/api/auth/email/verify", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify(
          emailErrorEnvelope(
            "UNAUTHENTICATED",
            "That code is not valid. Request a new code and try again.",
          ),
        ),
      });
    });

    await fillAndSendCode(page, email);
    await page.getByLabel("One-time code").fill("000000");
    await page.getByRole("button", { name: "Sign in" }).click();

    const error = page.locator("form").getByRole("alert");
    await expect(error).toContainText("That code is not valid");
    // Never distinguishes wrong/expired/unconfirmed — and never advances.
    await expect(page.getByLabel("One-time code")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Usage analytics" })).toHaveCount(0);
  });

  test("a rate-limited verify shows the wait the server asked for", async ({ page }) => {
    const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;

    await page.goto("/pilot");
    await mockRequestEndpoint(page);
    await page.route("**/api/auth/email/verify", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "30" },
        body: JSON.stringify(
          emailErrorEnvelope("RATE_LIMITED", "Too many sign-in attempts. Please wait and try again."),
        ),
      });
    });

    await fillAndSendCode(page, email);
    await page.getByLabel("One-time code").fill("123456");
    await page.getByRole("button", { name: "Sign in" }).click();

    const error = page.locator("form").getByRole("alert");
    await expect(error).toContainText("Too many sign-in attempts");
    await expect(error).toContainText("Wait about 30 seconds");
  });

  test("the resend control is disabled for a visible cooldown and re-enables after it", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date() });

    const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
    await page.goto("/pilot");
    await mockRequestEndpoint(page);

    await fillAndSendCode(page, email);

    const resend = page.getByRole("button", { name: "Send a new code" });
    await expect(resend).toBeDisabled();
    await expect(page.getByText(/Wait \d+s to request another code\./)).toBeVisible();

    await page.clock.fastForward(61_000);

    await expect(resend).toBeEnabled();
    await expect(page.getByText(/Wait \d+s to request another code\./)).toHaveCount(0);
  });
});

test.describe("email sign-in (live Supabase)", () => {
  const createdAccess: string[] = [];
  const createdAuthUsers: string[] = [];

  test.afterAll(async () => {
    // Child -> parent, then the auth account last: the FK is ON DELETE
    // RESTRICT (migration 0006), so the account cannot go while an actor row
    // still points at it.
    await deleteInvitations(createdAccess);
    await deleteAuthUsers(createdAuthUsers);
  });

  test("a real account signs in through the live provider and the shell reflects it", async ({
    page,
  }) => {
    const missing = missingLiveCredential();
    test.skip(Boolean(missing), `Missing live credential: ${missing}`);
    test.skip(
      !(process.env.EMAIL_SIGN_IN === "true" && Boolean(process.env.SUPABASE_PUBLISHABLE_KEY)),
      "EMAIL_SIGN_IN=true and SUPABASE_PUBLISHABLE_KEY are required for the email sign-in path",
    );
    const version = await schemaVersion();
    test.skip(version < 6, "BLOCKED: migration 0006 not applied");

    /**
     * `auth.admin.generateLink({ type: "magiclink" })` creates (or finds) the
     * account and returns `properties.email_otp` — the code an email would
     * have carried — without sending anything (see
     * tests/integration/auth-email.test.ts for the same technique). The SEND
     * half cannot be driven through the UI here: Supabase refuses to send to
     * a reserved test-domain address before any mail is attempted (asserted
     * in that suite's "maps a provider refusal" test), so this spec drives
     * only the VERIFY boundary — the one a mocked test cannot exercise for
     * real — through `POST /api/auth/email/verify` directly, then confirms
     * the shell renders what that session actually is.
     */
    const email = `c1-e2e-${randomUUID().slice(0, 12)}@example.test`;
    const client = liveClient();
    const { data, error } = await client.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error) throw new Error(`generateLink failed: ${error.message}`);
    const userId = data.user?.id;
    if (userId) createdAuthUsers.push(userId);
    const code = (data.properties as { email_otp?: string } | null)?.email_otp;
    expect(code, "auth.admin.generateLink must return properties.email_otp").toBeTruthy();

    const verifyRes = await page.request.post("/api/auth/email/verify", {
      headers: { Origin: E2E_ORIGIN },
      data: { email, code },
    });
    expect(verifyRes.ok(), await verifyRes.text().catch(() => "")).toBeTruthy();

    if (userId) {
      const accessId = await findVerifiedAccessId(userId);
      if (accessId) createdAccess.push(accessId);
    }

    await page.goto("/pilot/feed");
    const header = page.getByRole("banner");
    await expect(header).toContainText(email);
    await expect(header).toContainText("Signed in with email");
  });
});
