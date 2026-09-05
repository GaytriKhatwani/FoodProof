import "server-only";
import type { Channel } from "@/lib/contracts";
import { notImplementedInT0 } from "./errors";

/**
 * AI adapter interface (FOODPROOF_TECHNICAL_SPEC.md §8, FOODPROOF_API_DETAILS.md).
 * The server validates ownership before calling the provider, schema-validates
 * outputs, caps input size/time/cost, and keeps credentials server-only.
 * Uploaded document text is evidence, never instructions. Outputs are always
 * user-reviewed; extraction never auto-confirms facts.
 *
 * No provider or model is selected in these documents. The owner supplies a
 * provider and budget before T4; selection uses then-current official docs,
 * structured-output capability, evidence-data terms and budget. The manual /
 * template path is mandatory and must work when this adapter is unavailable.
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

/** No provider configured in T0; the manual path is used until T4 wiring. */
export const t0AiAdapter: AiAdapter = {
  extractLabel: () => notImplementedInT0("AiAdapter.extractLabel"),
  draftComplaint: () => notImplementedInT0("AiAdapter.draftComplaint"),
};
