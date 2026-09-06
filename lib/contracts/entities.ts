import { z } from "zod";
import {
  Channel,
  ContentKind,
  DemoRole,
  DraftMethod,
  EvidenceKind,
  EvidenceRole,
  Lifecycle,
  Preparation,
  RevisionState,
  UpdateKind,
  UploadState,
} from "./enums";

/**
 * Owner-facing read models returned by guarded APIs (FOODPROOF_API_DETAILS.md
 * "Read models"). Guarded media IDs are returned, never storage paths or secrets.
 */

export const Me = z.object({
  label: z.string(),
  role: DemoRole,
  analytics_consent: z.boolean(),
  /**
   * Whether the AI path is configured on this deployment. A capability flag
   * only — never a credential and never a promise that a call will succeed.
   * The reporter screens show NO assisted control while it is false
   * (FOODPROOF_SCREENS.md §5: "No AI control appears enabled unless its
   * backend is configured").
   */
  ai_available: z.boolean(),
});
export type Me = z.infer<typeof Me>;

/** Community-visibility badge derived from publication state. */
export const CommunityVisibility = z.enum([
  "private",
  "pending_review",
  "changes_requested",
  "rejected",
  "published",
  "withdrawn",
  "removed",
]);
export type CommunityVisibility = z.infer<typeof CommunityVisibility>;

export const ReportSummary = z.object({
  report_id: z.string().uuid(),
  product_name: z.string(),
  brand: z.string(),
  variant: z.string().nullable(),
  preparation: Preparation,
  lifecycle: Lifecycle,
  community_visibility: CommunityVisibility,
  version: z.number().int(),
  updated_at: z.string(),
});
export type ReportSummary = z.infer<typeof ReportSummary>;

export const EvidenceMeta = z.object({
  id: z.string().uuid(),
  kind: EvidenceKind,
  roles: z.array(EvidenceRole),
  mime_type: z.string(),
  bytes: z.number().int().nonnegative(),
  upload_state: UploadState,
  created_at: z.string(),
});
export type EvidenceMeta = z.infer<typeof EvidenceMeta>;

export const ComplaintDraft = z.object({
  id: z.string().uuid(),
  channel: Channel,
  subject: z.string(),
  body: z.string(),
  method: DraftMethod,
  version: z.number().int(),
  updated_at: z.string(),
});
export type ComplaintDraft = z.infer<typeof ComplaintDraft>;

export const Submission = z.object({
  id: z.string().uuid(),
  channel: Channel,
  recipient: z.string(),
  submitted_at: z.string(),
  reference: z.string().nullable(),
  has_acknowledgement: z.boolean(),
  created_at: z.string(),
});
export type Submission = z.infer<typeof Submission>;

export const ReportUpdate = z.object({
  id: z.string().uuid(),
  submission_id: z.string().uuid().nullable(),
  kind: UpdateKind,
  sender: z.string().nullable(),
  occurred_at: z.string(),
  summary: z.string(),
  has_attachment: z.boolean(),
  created_at: z.string(),
});
export type ReportUpdate = z.infer<typeof ReportUpdate>;

export const ReviewRequestState = z.object({
  publication_revision_id: z.string().uuid(),
  content_kind: ContentKind,
  /**
   * The recorded response this review request was raised for, or null for a
   * concern request. It lets the private timeline place a response request under
   * its own response instead of listing it by date. It is the owner's own id, not
   * any response content.
   */
  source_update_id: z.string().uuid().nullable(),
  state: RevisionState,
  reason: z.string().nullable(),
  revision: z.number().int(),
  created_at: z.string(),
});
export type ReviewRequestState = z.infer<typeof ReviewRequestState>;

/** Owner-only aggregate for the private timeline / resume (no client DB queries). */
export const ReportDetail = z.object({
  report_id: z.string().uuid(),
  product_id: z.string().uuid().nullable(),
  product_name: z.string(),
  brand: z.string(),
  variant: z.string().nullable(),
  concern_text: z.string().nullable(),
  claim_text: z.string().nullable(),
  ingredients_text: z.string().nullable(),
  facts_confirmed_at: z.string().nullable(),
  observation_date: z.string().nullable(),
  batch_number: z.string().nullable(),
  preparation: Preparation,
  lifecycle: Lifecycle,
  close_reason: z.string().nullable(),
  community_visibility: CommunityVisibility,
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  evidence: z.array(EvidenceMeta),
  complaint_drafts: z.array(ComplaintDraft),
  submissions: z.array(Submission),
  updates: z.array(ReportUpdate),
  review_requests: z.array(ReviewRequestState),
});
export type ReportDetail = z.infer<typeof ReportDetail>;

export const ReviewQueueItem = z.object({
  publication_revision_id: z.string().uuid(),
  report_id: z.string().uuid(),
  content_kind: ContentKind,
  request_type: z.enum(["report", "response", "correction"]),
  requested_at: z.string(),
  brand: z.string(),
  product_name: z.string(),
});
export type ReviewQueueItem = z.infer<typeof ReviewQueueItem>;

export const CursorPage = z.object({
  next_cursor: z.string().nullable(),
});
export type CursorPage = z.infer<typeof CursorPage>;
