import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Channel } from "@/lib/contracts";
import { getServerEnv } from "./env";
import { AI_LIMITS, PRICED_MODELS, type AiLimits } from "./ai/limits";
import { createAnthropicAdapter, type LoadImage } from "./ai/anthropic";

/**
 * AI adapter interface (FOODPROOF_TECHNICAL_SPEC.md §8, FOODPROOF_API_DETAILS.md).
 * The server validates ownership before calling the provider, schema-validates
 * outputs, caps input size/time/cost, and keeps credentials server-only.
 * Uploaded document text is evidence, never instructions. Outputs are always
 * user-reviewed; extraction never auto-confirms facts.
 *
 * The interface below is frozen (T0). T4 adds the provider implementation in
 * ./ai/ and a metered superset (`MeteredAiAdapter`) that also reports the real
 * token usage of a call, because the durable spend ledger settles against actual
 * usage. The manual / template path is mandatory and must keep working when
 * `getAiAdapter()` returns null.
 */

export interface LabelExtraction {
  claimText?: string;
  ingredientsText?: string;
  productName?: string;
  brand?: string;
  unreadableFields: string[];
}

export interface ConfirmedFacts {
  productName: string;
  brand: string;
  variant: string | null;
  observationDate: string | null;
  claimText: string | null;
  ingredientsText: string | null;
  concernText: string;
}

export interface ComplaintDraftText {
  subject: string;
  body: string;
}

export interface AiAdapter {
  extractLabel(ownedEvidenceIds: string[]): Promise<LabelExtraction>;
  draftComplaint(
    confirmedFacts: ConfirmedFacts,
    channel: Channel,
  ): Promise<ComplaintDraftText>;
}

// ---------------------------------------------------------------------------
// T4 additions. Additive only: `MeteredAiAdapter` extends the frozen interface.
// ---------------------------------------------------------------------------

/** Real token usage of one provider call, used to settle the spend ledger. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface MeteredResult<T> {
  result: T;
  usage: AiUsage;
}

/**
 * An `AiAdapter` that also reports what each call actually cost in tokens and
 * names the model it used, so `ai_spend_ledger` records the truth rather than
 * the reservation estimate.
 */
export interface MeteredAiAdapter extends AiAdapter {
  readonly model: string;
  extractLabelMetered(
    ownedEvidenceIds: string[],
  ): Promise<MeteredResult<LabelExtraction>>;
  draftComplaintMetered(
    confirmedFacts: ConfirmedFacts,
    channel: Channel,
  ): Promise<MeteredResult<ComplaintDraftText>>;
}

/** Documented default when `AI_MODEL` is unset. */
export const DEFAULT_AI_MODEL = "claude-sonnet-5";

/** The provider's public API; pinned so no ambient `ANTHROPIC_BASE_URL` can redirect evidence. */
const PROVIDER_BASE_URL = "https://api.anthropic.com";

/**
 * The one condition under which the AI path is on: the configured provider is
 * the supported one, a key is present, and the chosen model has a price row in
 * `PRICED_MODELS` (an unpriced model could not be metered against the cap).
 * Returns the resolved model id, or null when AI is switched off — a supported
 * state in which routes answer DEPENDENCY_UNAVAILABLE and every screen keeps its
 * manual/template path (FOODPROOF_SCREENS.md §5).
 */
function configuredModel(): string | null {
  const env = getServerEnv();
  if (env.AI_PROVIDER !== "anthropic" || !env.AI_PROVIDER_API_KEY) return null;
  const model = env.AI_MODEL ?? DEFAULT_AI_MODEL;
  if (!PRICED_MODELS[model]) {
    // The model id is operator configuration, not content; naming it is the
    // only way an operator can see why AI stayed off.
    console.warn("[ai] AI_MODEL has no price row in lib/server/ai/limits.ts; AI assistance is switched off", {
      model,
    });
    return null;
  }
  return model;
}

/** Capability flag for `GET /api/me` (`ai_available`): never a credential. */
export function isAiConfigured(): boolean {
  return configuredModel() !== null;
}

/**
 * The configured adapter, or null when the AI path is switched off.
 *
 * The provider SDK is constructed with the key from `getServerEnv()` only and
 * with its base URL, auth token and logging pinned, so nothing in the process
 * environment (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
 * `ANTHROPIC_LOG`) can enable a disabled feature, redirect evidence bytes, or
 * switch on request logging that would print image bodies.
 *
 * `loadImage` is supplied by the caller because there is deliberately no
 * default that can read evidence bytes: only `lib/server/ai/assist.ts`, which
 * has already proved ownership and validated the files, hands images to the
 * provider. The drafting path never loads images, so it needs no loader.
 */
export function getAiAdapter(deps?: {
  loadImage?: LoadImage;
  limits?: AiLimits;
}): MeteredAiAdapter | null {
  const model = configuredModel();
  if (!model) return null;
  const env = getServerEnv();

  // Prices always come from the row for the model actually in use.
  const limits: AiLimits = { ...(deps?.limits ?? AI_LIMITS), ...PRICED_MODELS[model]! };
  const client = new Anthropic({
    apiKey: env.AI_PROVIDER_API_KEY,
    authToken: null,
    baseURL: PROVIDER_BASE_URL,
    logLevel: "off",
    timeout: limits.timeoutMs,
    maxRetries: 1,
  });
  return createAnthropicAdapter({
    client,
    model,
    loadImage:
      deps?.loadImage ??
      (() => {
        throw new Error("getAiAdapter: extraction needs an explicit image loader.");
      }),
    limits,
  });
}
