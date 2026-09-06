import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Channel } from "@/lib/contracts";
import { getServerEnv } from "./env";
import { AI_LIMITS, type AiLimits } from "./ai/limits";
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

/**
 * The configured adapter, or null when the AI path is switched off. Null is a
 * supported state: routes answer DEPENDENCY_UNAVAILABLE and every screen keeps
 * its manual/template path (FOODPROOF_SCREENS.md §5).
 *
 * The provider SDK is constructed with the key from `getServerEnv()` only. It is
 * never allowed to discover a key from its own environment lookup, so a stray
 * `ANTHROPIC_API_KEY` on a machine cannot silently enable a disabled feature.
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
  const env = getServerEnv();
  if (env.AI_PROVIDER !== "anthropic" || !env.AI_PROVIDER_API_KEY) return null;

  const limits = deps?.limits ?? AI_LIMITS;
  const client = new Anthropic({
    apiKey: env.AI_PROVIDER_API_KEY,
    timeout: limits.timeoutMs,
    maxRetries: 1,
  });
  return createAnthropicAdapter({
    client,
    model: env.AI_MODEL ?? DEFAULT_AI_MODEL,
    loadImage:
      deps?.loadImage ??
      (() => {
        throw new Error("getAiAdapter: extraction needs an explicit image loader.");
      }),
    limits,
  });
}
