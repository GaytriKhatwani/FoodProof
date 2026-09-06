import { z } from "zod";
import { Channel } from "./enums";

/**
 * AI assistance response contracts (FOODPROOF_API_DETAILS.md "AI endpoints",
 * FOODPROOF_TECHNICAL_SPEC.md §8). These are the HTTP shapes of the frozen
 * `AiAdapter` results in lib/server/ai.ts:
 *
 * - Extraction returns SUGGESTIONS plus the fields it could not read. It never
 *   updates or confirms report facts; the reporter applies each suggestion
 *   deliberately and confirms with `POST /api/reports/:id/confirm-facts`
 *   (`method: "assisted"` only after a real assisted result).
 * - Drafting returns an EDITABLE suggestion; saving it is the separate
 *   `PUT /api/reports/:id/complaint-drafts/:channel` with `method: "assisted"`.
 *
 * `method` is always the literal `assisted` here — deterministic output stays
 * `template` (FOODPROOF_MEASUREMENT_AND_PILOT.md §4) and never travels through
 * these shapes. Nothing in these responses is persisted by the server.
 */

/** Fields extraction may suggest; mirrors `LabelExtraction` in lib/server/ai.ts. */
export const AiExtractField = z.enum([
  "product_name",
  "brand",
  "claim_text",
  "ingredients_text",
]);
export type AiExtractField = z.infer<typeof AiExtractField>;

/** A suggested value per field; `null` when the provider offered nothing for it. */
export const AiExtractSuggestions = z
  .object({
    product_name: z.string().nullable(),
    brand: z.string().nullable(),
    claim_text: z.string().nullable(),
    ingredients_text: z.string().nullable(),
  })
  .strict();
export type AiExtractSuggestions = z.infer<typeof AiExtractSuggestions>;

export const AiExtractResponse = z
  .object({
    method: z.literal("assisted"),
    /** The owned evidence actually sent to the provider (validated server-side). */
    evidence_ids: z.array(z.string().uuid()),
    suggestions: AiExtractSuggestions,
    /** Fields the provider reported as unreadable or absent from the photos. */
    unreadable_fields: z.array(AiExtractField),
  })
  .strict();
export type AiExtractResponse = z.infer<typeof AiExtractResponse>;

export const AiDraftResponse = z
  .object({
    method: z.literal("assisted"),
    channel: Channel,
    subject: z.string(),
    body: z.string(),
  })
  .strict();
export type AiDraftResponse = z.infer<typeof AiDraftResponse>;
