import "server-only";
import { z } from "zod";

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

const ServerEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  MIXPANEL_TOKEN: z.string().min(1),
  MIXPANEL_API_HOST: z.string().url(),
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
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cached: ServerEnv | null = null;

/** Validate and return the server env, throwing a readable error if invalid. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Invalid or missing server environment: ${missing}. See .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
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
  } as const;
}
