import "server-only";

/**
 * The single source of truth for every AI input, time and cost limit
 * (FOODPROOF_TECHNICAL_SPEC.md §8: "caps input size/time/cost"). Nothing else
 * hard-codes a cap: the service, the ledger wrapper and the provider adapter all
 * read this object, and tests inject a modified copy to prove a cap without
 * spending real money.
 *
 * All money is micro-USD (1 USD = 1,000,000 micros), matching the
 * `ai_spend_ledger` columns in
 * `supabase/migrations/0004_publication_atomicity_and_ai_spend.sql`.
 */

export const MICROS_PER_USD = 1_000_000;

export type AiImageMime = "image/jpeg" | "image/png" | "image/webp";

export interface AiLimits {
  /** Most label photographs one extraction may send. */
  readonly maxEvidencePerCall: number;
  /** Largest single image accepted, matching the upload cap in evidence.ts. */
  readonly maxImageBytes: number;
  /** Image types the provider is allowed to see. No PDF, no GIF. */
  readonly allowedImageMimeTypes: readonly AiImageMime[];
  /** Per-attempt provider timeout in milliseconds (SDK timeouts are ms). */
  readonly timeoutMs: number;
  readonly maxOutputTokensExtract: number;
  readonly maxOutputTokensDraft: number;
  /** Ceiling for one reservation; a bigger estimate is refused (FP402). */
  readonly perCallCapMicros: number;
  /** Ceiling for everything one invitation may ever spend. */
  readonly perInvitationCapMicros: number;
  /** The owner's hard ceiling for the whole pilot. */
  readonly totalCapMicros: number;
  readonly rateLimitCalls: number;
  readonly rateLimitWindowSeconds: number;
  /** Published list price, micro-USD per million input tokens. */
  readonly inputMicrosPerMillionTokens: number;
  /** Published list price, micro-USD per million output tokens. */
  readonly outputMicrosPerMillionTokens: number;
  /** Worst case for one image on the high-resolution vision tier. */
  readonly estimatedTokensPerImage: number;
  /** Floor for the system + instruction text of one call. */
  readonly estimatedPromptTokens: number;
}

/**
 * List prices per model, micro-USD per million tokens. The ledger settles real
 * usage at these prices, so a model that is not listed here cannot be metered
 * honestly: `getAiAdapter()` refuses to enable AI for an unlisted `AI_MODEL`
 * rather than under-counting against the owner's hard cap. Add a row (from the
 * provider's published pricing) before pinning a different model.
 */
export const PRICED_MODELS: Readonly<
  Record<string, Pick<AiLimits, "inputMicrosPerMillionTokens" | "outputMicrosPerMillionTokens">>
> = {
  "claude-sonnet-5": {
    inputMicrosPerMillionTokens: 2_000_000, // $2.00 / MTok
    outputMicrosPerMillionTokens: 10_000_000, // $10.00 / MTok
  },
};

export const AI_LIMITS: AiLimits = {
  maxEvidencePerCall: 3,
  maxImageBytes: 3 * 1024 * 1024,
  allowedImageMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  timeoutMs: 30_000,
  maxOutputTokensExtract: 1024,
  maxOutputTokensDraft: 1500,
  perCallCapMicros: 60_000, // $0.06
  perInvitationCapMicros: 500_000, // $0.50
  totalCapMicros: 2_000_000, // $2.00 — the owner's hard cap for the pilot
  rateLimitCalls: 6,
  rateLimitWindowSeconds: 60,
  ...PRICED_MODELS["claude-sonnet-5"]!,
  estimatedTokensPerImage: 4784,
  estimatedPromptTokens: 1200,
};

/**
 * Upper bound on the input tokens one call can consume. Text is estimated at
 * three characters per token — deliberately pessimistic for English so a long
 * concern description raises the reservation instead of quietly overspending;
 * a request whose estimate exceeds `perCallCapMicros` is refused by
 * `fp_reserve_ai_spend` before the provider is contacted.
 */
export function estimateInputTokens(
  limits: AiLimits,
  input: { imageCount: number; promptCharacters: number },
): number {
  const textTokens = Math.max(
    limits.estimatedPromptTokens,
    Math.ceil(input.promptCharacters / 3),
  );
  return textTokens + input.imageCount * limits.estimatedTokensPerImage;
}

function micros(tokens: number, microsPerMillion: number): number {
  return Math.ceil((tokens * microsPerMillion) / 1_000_000);
}

/** What to reserve before a call: worst-case input plus the whole output cap. */
export function reservationMicros(
  limits: AiLimits,
  input: { imageCount: number; promptCharacters: number; maxOutputTokens: number },
): number {
  return (
    micros(estimateInputTokens(limits, input), limits.inputMicrosPerMillionTokens) +
    micros(input.maxOutputTokens, limits.outputMicrosPerMillionTokens)
  );
}

/** What actually to charge once the provider reported its real token usage. */
export function settlementMicros(
  limits: AiLimits,
  usage: { inputTokens: number; outputTokens: number },
): number {
  return (
    micros(Math.max(0, usage.inputTokens), limits.inputMicrosPerMillionTokens) +
    micros(Math.max(0, usage.outputTokens), limits.outputMicrosPerMillionTokens)
  );
}
