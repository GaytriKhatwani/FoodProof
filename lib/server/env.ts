import "server-only";
import { z } from "zod";
import { Audience } from "@/lib/contracts";

/**
 * Server-only environment validation (FOODPROOF_TECHNICAL_SPEC.md §9).
 * Secrets never reach the browser and are never prefixed NEXT_PUBLIC_.
 * Validation is lazy so the static public homepage renders even when demo
 * dependencies are unavailable.
 */

/** Treat a present-but-empty env var (e.g. `AI_PROVIDER=`) as unset. */
const optionalSecret = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);

/**
 * Analytics audience separator (FOODPROOF_MEASUREMENT_AND_PILOT.md §1/§3: "set
 * by deployment/test session configuration"). `qa` marks local/QA traffic so it
 * can be excluded from invited-tester reports; an unset value means a real
 * invited deployment. An INVALID value is a hard error — a typo must never
 * silently become `invited_pilot`.
 */
const AnalyticsAudienceEnv = z.preprocess(
  (v) => (v === "" ? undefined : v),
  Audience.default("invited_pilot"),
);

/**
 * Reviewer allowlist for verified accounts (phase two C.1). Read through
 * `moderatorEmailsEnv()` rather than the memoised `getServerEnv()`, for the same
 * reason as `analyticsAudience()`: it is the SAME schema field, but the
 * allowlist must be re-read rather than frozen at first use, so
 * `lib/server/session.ts` can self-heal a role the moment the deployed value
 * changes.
 */
const ModeratorEmailsEnv = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().optional(),
);

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  MIXPANEL_TOKEN: z.string().min(1),
  MIXPANEL_API_HOST: z.string().url(),
  ANALYTICS_AUDIENCE: AnalyticsAudienceEnv,
  APP_ORIGIN: z.string().url(),
  RATE_LIMIT_HMAC_KEY: z.string().min(1),
  DEMO_MODE: z.literal("true"),
  // Selected at T4; optional until the AI path is enabled. An empty value in a
  // local env file counts as unset rather than an invalid value. The adapter
  // (lib/server/ai/) is enabled only when BOTH provider and key are present;
  // it never falls back to a provider SDK's own environment lookup.
  AI_PROVIDER: optionalSecret,
  AI_PROVIDER_API_KEY: optionalSecret,
  // Optional pinned model id; the adapter's documented default applies when unset.
  AI_MODEL: optionalSecret,
  // Names one allowlisted government destination key (lib/server/official.ts).
  // Optional until T5 owner configuration; NOT a URL — an unknown or empty value
  // leaves the "Open official portal" action disabled rather than opening it.
  OFFICIAL_PORTAL_KEY: optionalSecret,
  // --- Phase two C.1: email sign-in (docs/FOODPROOF_DECISIONS.md D18) ---
  // `EMAIL_SIGN_IN=true` enables the ADDITIONAL email sign-in path. Anything
  // else (including empty) leaves it off, and invitation entry behaves exactly
  // as in phase one. The two paths run side by side.
  EMAIL_SIGN_IN: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.literal("true").optional(),
  ),
  // The Supabase publishable key: the key a browser would hold. The server uses
  // it for the per-request auth client that sends and verifies one-time codes,
  // so a user's token never touches the service client. It is still never sent
  // to the browser by this application and never prefixed NEXT_PUBLIC_.
  SUPABASE_PUBLISHABLE_KEY: optionalSecret,
  // Comma-separated reviewer allowlist for VERIFIED accounts only. There is no
  // role table: the role of a verified actor is computed from this value on
  // every sign-in and re-checked on every request (lib/server/moderators.ts).
  // Unset or empty means no verified account is a reviewer.
  MODERATOR_EMAILS: ModeratorEmailsEnv,
  // Optional. The raw code of ONE user-role invitation the owner chooses to
  // publish on the entry page so any visitor can walk the demo without asking
  // for a code. The row itself is created like any other invitation
  // (scripts/create-invitations.mjs); this value only decides whether the entry
  // page shows it. Anyone who can load the page can enter as that demo user, so
  // set it only for a demo whose content is all sample or redacted material.
  DEMO_PUBLIC_USER_CODE: optionalSecret,
})
  // Enabling email sign-in without the publishable key would leave the routes
  // advertised but unable to reach the provider. Fail at startup with a
  // readable message instead of at the first sign-in attempt.
  .refine(
    (env) => env.EMAIL_SIGN_IN !== "true" || Boolean(env.SUPABASE_PUBLISHABLE_KEY),
    {
      path: ["SUPABASE_PUBLISHABLE_KEY"],
      message:
        "EMAIL_SIGN_IN=true requires SUPABASE_PUBLISHABLE_KEY (the per-request auth client uses it).",
    },
  );

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Pure validation of one environment source. Exported so the refinement rules
 * can be unit tested without mutating (and caching) the real process env.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Invalid or missing server environment: ${missing}. See .env.example.`,
    );
  }
  return parsed.data;
}

/** Validate and return the server env, throwing a readable error if invalid. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  cached = parseServerEnv(process.env);
  return cached;
}

/** The reviewer allowlist as configured right now (see `ModeratorEmailsEnv`). */
export function moderatorEmailsEnv(): string | undefined {
  return ModeratorEmailsEnv.parse(process.env.MODERATOR_EMAILS);
}

/**
 * Whether the email sign-in path is enabled on this deployment: the flag AND
 * the publishable key the per-request auth client needs. It reports the same
 * fact as `serverEnvStatus().email_sign_in` — one definition — so a server
 * component and the sign-in service can never disagree about whether the path
 * exists. The startup refinement above makes "flag without key" a loud error,
 * so this only ever reads false in a deployment that never enabled the flag.
 */
export function emailSignInEnabled(): boolean {
  return serverEnvStatus().email_sign_in;
}

/**
 * The analytics audience alone, without requiring the whole demo environment to
 * validate. It parses the SAME schema field as `getServerEnv()`, so there is one
 * definition; it exists because analytics must keep working (and unit tests must
 * keep running) in contexts where Supabase/Mixpanel configuration is absent.
 */
export function analyticsAudience(): z.infer<typeof Audience> {
  return AnalyticsAudienceEnv.parse(process.env.ANALYTICS_AUDIENCE);
}

/**
 * Non-throwing presence report for diagnostics/readiness. Returns booleans
 * only — never values — so it is safe to expose which config groups are set.
 */
export function serverEnvStatus() {
  const p = process.env;
  return {
    supabase: Boolean(p.SUPABASE_URL && p.SUPABASE_SECRET_KEY),
    mixpanel: Boolean(p.MIXPANEL_TOKEN && p.MIXPANEL_API_HOST),
    app_origin: Boolean(p.APP_ORIGIN),
    rate_limit_key: Boolean(p.RATE_LIMIT_HMAC_KEY),
    demo_mode: p.DEMO_MODE === "true",
    ai: Boolean(p.AI_PROVIDER && p.AI_PROVIDER_API_KEY),
    // Both halves are required, matching the schema refinement above: the flag
    // alone never advertises a sign-in path the server cannot serve.
    email_sign_in: p.EMAIL_SIGN_IN === "true" && Boolean(p.SUPABASE_PUBLISHABLE_KEY),
  } as const;
}

/**
 * The invitation code the owner has chosen to publish on the entry page, or
 * null when none is. Read by the `/pilot` server component only; it is the one
 * secret this application deliberately renders into a page, by the owner's
 * explicit configuration.
 */
export function publicDemoUserCode(): string | null {
  const value = getServerEnv().DEMO_PUBLIC_USER_CODE?.trim();
  return value ? value : null;
}
