import { z } from "zod";
import { EvidenceRole, PublicExternalStatus } from "./enums";

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

/**
 * One frozen, reviewed image of an approved revision: the guarded media ID plus
 * the label roles it shows. The roles come from the OWNED source evidence the
 * reviewed copy was made from, so a reporter who later re-labels that photo can
 * change which approved image is described as the identity one — the bytes
 * served are always the frozen copy of the approved revision.
 */
export const PublicApprovedAsset = z.object({
  id: z.string().uuid(),
  roles: z.array(EvidenceRole),
});
export type PublicApprovedAsset = z.infer<typeof PublicApprovedAsset>;

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
  /**
   * Guarded media ID of the reviewed identity photo of THIS approved revision,
   * for the feed card thumbnail — null when the revision has no identity-role
   * image (revisions frozen before migration 0005 enforced the three roles).
   * Optional so the field is purely additive: a projection built before it
   * existed still parses. It is a media ID served by
   * `GET /api/publication-assets/:id`, never a storage path or a public URL, and
   * that route stops serving it as soon as the parent stops being visible.
   */
  thumbnail_asset_id: z.string().uuid().nullable().optional(),
});
export type PublicFeedItem = z.infer<typeof PublicFeedItem>;

/** Full approved concern projection used by the detail screen. */
export const PublicReport = PublicFeedItem.extend({
  confirmed_claim_text: z.string().nullable(),
  confirmed_ingredients_text: z.string().nullable(),
  /** Guarded media IDs only — never storage paths. */
  approved_asset_ids: z.array(z.string().uuid()),
  /**
   * The same assets, in the same order, with the label roles each one shows.
   * Additive and optional: `approved_asset_ids` stays the authoritative list of
   * IDs and is unchanged.
   */
  approved_assets: z.array(PublicApprovedAsset).optional(),
  responses: z.array(PublicResponseSummary),
});
export type PublicReport = z.infer<typeof PublicReport>;
