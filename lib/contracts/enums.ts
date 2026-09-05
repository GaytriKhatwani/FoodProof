import { z } from "zod";

/**
 * Domain enums shared by database, services and UI. These are the frozen T0
 * vocabulary; changing a value is a shared-contract change owned by the
 * integration owner. Names mirror FOODPROOF_TECHNICAL_SPEC.md §4 / §5 and
 * FOODPROOF_API_DETAILS.md.
 */

export const DemoRole = z.enum(["user", "reviewer"]);
export type DemoRole = z.infer<typeof DemoRole>;

/** Analytics-facing actor role (database `user` maps to `reporter`). */
export const ActorRole = z.enum(["visitor", "reporter", "reviewer"]);
export type ActorRole = z.infer<typeof ActorRole>;

export const Preparation = z.enum(["draft", "ready"]);
export type Preparation = z.infer<typeof Preparation>;

export const Lifecycle = z.enum(["open", "closed_by_reporter"]);
export type Lifecycle = z.infer<typeof Lifecycle>;

export const EvidenceKind = z.enum([
  "label",
  "receipt",
  "acknowledgement",
  "response",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const EvidenceRole = z.enum(["identity", "claim", "ingredients"]);
export type EvidenceRole = z.infer<typeof EvidenceRole>;

export const UploadState = z.enum(["pending", "ready", "failed"]);
export type UploadState = z.infer<typeof UploadState>;

export const Channel = z.enum(["brand", "government"]);
export type Channel = z.infer<typeof Channel>;

export const DraftMethod = z.enum(["template", "assisted"]);
export type DraftMethod = z.infer<typeof DraftMethod>;

/** Fact-confirmation method (manual entry vs a real assisted result). */
export const ConfirmMethod = z.enum(["manual", "assisted"]);
export type ConfirmMethod = z.infer<typeof ConfirmMethod>;

export const UpdateKind = z.enum([
  "follow_up",
  "response",
  "closed",
  "reopened",
  "label_change_claim",
]);
export type UpdateKind = z.infer<typeof UpdateKind>;

/** Stored moderation state on a publication revision. */
export const RevisionState = z.enum([
  "pending_review",
  "changes_requested",
  "rejected",
  "approved",
  "withdrawn",
  "removed",
]);
export type RevisionState = z.infer<typeof RevisionState>;

/** Reviewer decision action carried by the API (maps to stored states). */
export const DecisionAction = z.enum(["approve", "request_changes", "reject"]);
export type DecisionAction = z.infer<typeof DecisionAction>;

/** Analytics moderation decision enum (adds `removed`). */
export const ModerationDecision = z.enum([
  "approved",
  "changes_requested",
  "rejected",
  "removed",
]);
export type ModerationDecision = z.infer<typeof ModerationDecision>;

/** Reviewed, per-channel public external status (never recomputed from private tables). */
export const PublicExternalStatus = z.enum([
  "no_submission_recorded",
  "submission_reported",
  "acknowledgement_attached",
  "response_reported",
]);
export type PublicExternalStatus = z.infer<typeof PublicExternalStatus>;

export const FlagState = z.enum(["open", "handled"]);
export type FlagState = z.infer<typeof FlagState>;

export const ContentKind = z.enum(["concern", "response"]);
export type ContentKind = z.infer<typeof ContentKind>;
