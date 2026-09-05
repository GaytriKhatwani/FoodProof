import { z } from "zod";
import {
  Channel,
  ConfirmMethod,
  DecisionAction,
  DraftMethod,
  EvidenceRole,
} from "./enums";

/**
 * Request body schemas (FOODPROOF_TECHNICAL_SPEC.md §6, FOODPROOF_API_DETAILS.md).
 * All use `.strict()` so unknown fields are rejected; request JSON is never
 * passed directly into database updates. Expected-version guards optimistic
 * concurrency; owner and role are resolved server-side, never from the body.
 */

const uuid = z.string().uuid();
const optionalText = z.string().trim().min(1).nullable();

/** Optimistic-concurrency guard: null on first create, otherwise the current integer. */
export const ExpectedVersion = z.number().int().nonnegative().nullable();

export const SessionCreateRequest = z
  .object({ invitation_code: z.string().min(1) })
  .strict();
export type SessionCreateRequest = z.infer<typeof SessionCreateRequest>;

export const AnalyticsConsentRequest = z
  .object({ allowed: z.boolean() })
  .strict();
export type AnalyticsConsentRequest = z.infer<typeof AnalyticsConsentRequest>;

/** Report create/patch accept only these fields; server validates ownership + linkage. */
export const ReportWriteRequest = z
  .object({
    product_name: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    variant: optionalText.optional(),
    observation_date: z.string().date().nullable().optional(),
    batch_number: optionalText.optional(),
    concern_text: z.string().nullable().optional(),
    claim_text: z.string().nullable().optional(),
    ingredients_text: z.string().nullable().optional(),
    product_id: uuid.nullable().optional(),
    expected_version: ExpectedVersion,
  })
  .strict();
export type ReportWriteRequest = z.infer<typeof ReportWriteRequest>;

export const ConfirmFactsRequest = z
  .object({
    expected_version: ExpectedVersion,
    claim_text: z.string().nullable(),
    ingredients_text: z.string().nullable(),
    method: ConfirmMethod,
  })
  .strict();
export type ConfirmFactsRequest = z.infer<typeof ConfirmFactsRequest>;

/** Evidence metadata that accompanies a single multipart upload. */
export const EvidenceUploadMeta = z
  .object({
    kind: z.enum(["label", "receipt", "acknowledgement", "response"]),
    roles: z.array(EvidenceRole).max(3).default([]),
  })
  .strict();
export type EvidenceUploadMeta = z.infer<typeof EvidenceUploadMeta>;

export const EvidenceRolesPatch = z
  .object({
    roles: z.array(EvidenceRole).max(3),
    report_expected_version: ExpectedVersion,
  })
  .strict();
export type EvidenceRolesPatch = z.infer<typeof EvidenceRolesPatch>;

export const PrepareRequest = z.object({ channel: Channel }).strict();
export type PrepareRequest = z.infer<typeof PrepareRequest>;

export const ComplaintDraftWriteRequest = z
  .object({
    subject: z.string().min(1),
    body: z.string().min(1),
    method: DraftMethod,
    expected_version: ExpectedVersion,
  })
  .strict();
export type ComplaintDraftWriteRequest = z.infer<
  typeof ComplaintDraftWriteRequest
>;

export const SubmissionCreateRequest = z
  .object({
    channel: Channel,
    recipient: z.string().trim().min(1),
    submitted_at: z.string().date(),
    reference: optionalText.optional(),
    acknowledgement_evidence_id: uuid.nullable().optional(),
  })
  .strict();
export type SubmissionCreateRequest = z.infer<typeof SubmissionCreateRequest>;

export const UpdateCreateRequest = z
  .object({
    submission_id: uuid.nullable(),
    kind: z.enum(["follow_up", "response"]),
    sender: optionalText.optional(),
    occurred_at: z.string().date(),
    summary: z.string().trim().min(1),
    evidence_id: uuid.nullable().optional(),
  })
  .strict();
export type UpdateCreateRequest = z.infer<typeof UpdateCreateRequest>;

export const CloseRequest = z
  .object({ reason: z.string().trim().min(1) })
  .strict();
export type CloseRequest = z.infer<typeof CloseRequest>;

export const PublicationRequest = z
  .object({
    expected_version: ExpectedVersion,
    consent: z.literal(true),
    selected_evidence_ids: z.array(uuid).min(1),
    source_update_id: uuid.optional(),
  })
  .strict();
export type PublicationRequest = z.infer<typeof PublicationRequest>;

export const ReviewDecisionRequest = z
  .object({
    expected_version: ExpectedVersion,
    action: DecisionAction,
    reason: z.string().trim().min(1).optional(),
  })
  .strict();
export type ReviewDecisionRequest = z.infer<typeof ReviewDecisionRequest>;

export const RelinkRequest = z
  .object({ product_id: uuid, reason: z.string().trim().min(1) })
  .strict();
export type RelinkRequest = z.infer<typeof RelinkRequest>;

export const FlagRequest = z
  .object({
    reason: z.string().trim().min(1),
    detail: z.string().trim().min(1).optional(),
  })
  .strict();
export type FlagRequest = z.infer<typeof FlagRequest>;

export const FeedQuery = z
  .object({
    q: z.string().trim().max(120).optional(),
    cursor: z.string().optional(),
  })
  .strict();
export type FeedQuery = z.infer<typeof FeedQuery>;

export const ProductMatchQuery = z
  .object({
    brand: z.string().trim().min(1),
    name: z.string().trim().min(1),
    variant: z.string().trim().optional(),
  })
  .strict();
export type ProductMatchQuery = z.infer<typeof ProductMatchQuery>;

export const AiExtractRequest = z
  .object({ evidence_ids: z.array(uuid).min(1) })
  .strict();
export type AiExtractRequest = z.infer<typeof AiExtractRequest>;

export const AiDraftRequest = z.object({ channel: Channel }).strict();
export type AiDraftRequest = z.infer<typeof AiDraftRequest>;
