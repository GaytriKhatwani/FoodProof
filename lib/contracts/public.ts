import { z } from "zod";
import { PublicExternalStatus } from "./enums";

/**
 * Public projection allowlist (FOODPROOF_TECHNICAL_SPEC.md §5).
 * The server constructs these from owned, persisted data. They must NEVER
 * contain owner IDs, original object paths, reference numbers, recipient
 * contacts, private close reasons, or private attachments.
 */

/** A separately reviewed response summary attached to a visible parent concern. */
export const PublicResponseSummary = z.object({
  publication_revision_id: z.string().uuid(),
  channel: z.enum(["brand", "government"]),
  summary: z.string(),
  occurred_at: z.string(),
  has_attachment: z.boolean(),
  /** "Recorded by reporter" — provenance is always reporter-supplied. */
  provenance: z.literal("user_recorded"),
});
export type PublicResponseSummary = z.infer<typeof PublicResponseSummary>;

/** Per-channel reviewed external status snapshot. */
export const PublicExternalStatusByChannel = z.object({
  brand: PublicExternalStatus,
  government: PublicExternalStatus,
  /** Date the snapshot's external status was recorded, if any. */
  as_recorded_at: z.string().nullable(),
});
export type PublicExternalStatusByChannel = z.infer<
  typeof PublicExternalStatusByChannel
>;

/** Card shape used by the feed list. */
export const PublicFeedItem = z.object({
  report_id: z.string().uuid(),
  publication_revision_id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string(),
  brand: z.string(),
  variant: z.string().nullable(),
  concern_summary: z.string(),
  observation_date: z.string().nullable(),
  published_at: z.string(),
  author_label: z.literal("Anonymous contributor"),
  external_status: PublicExternalStatusByChannel,
});
export type PublicFeedItem = z.infer<typeof PublicFeedItem>;

/** Full approved concern projection used by the detail screen. */
export const PublicReport = PublicFeedItem.extend({
  confirmed_claim_text: z.string().nullable(),
  confirmed_ingredients_text: z.string().nullable(),
  /** Guarded media IDs only — never storage paths. */
  approved_asset_ids: z.array(z.string().uuid()),
  responses: z.array(PublicResponseSummary),
});
export type PublicReport = z.infer<typeof PublicReport>;
