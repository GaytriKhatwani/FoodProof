import { z } from "zod";
import { ActorRole, Channel, ContentKind, ModerationDecision } from "./enums";

/**
 * Analytics envelope + event dictionary (FOODPROOF_MEASUREMENT_AND_PILOT.md §3–4).
 * The server derives actor/role/consent/audience/session/mode/app_version and
 * rejects client attempts to override them. Only allowlisted events/properties
 * are accepted. No content, PII, search text, or raw addresses ever appear here.
 */

export const AnalyticsMode = z.literal("demo");
export const Audience = z.enum(["qa", "invited_pilot"]);
export const SchemaVersion = z.literal(1);

/** Context the SERVER attaches to every event (never trusted from the client). */
export const AnalyticsEnvelope = z.object({
  analytics_actor_id: z.string(),
  session_id: z.string(),
  analytics_mode: AnalyticsMode,
  audience: Audience,
  actor_role: ActorRole,
  app_version: z.string(),
  schema_version: SchemaVersion,
});
export type AnalyticsEnvelope = z.infer<typeof AnalyticsEnvelope>;

export const EventName = z.enum([
  "demo_entered",
  "feed_viewed",
  "feed_search_completed",
  "feed_report_viewed",
  "report_started",
  "report_saved",
  "evidence_uploaded",
  "facts_confirmed",
  "complaint_draft_saved",
  "complaint_text_copied",
  "official_channel_opened",
  "brand_email_opened",
  "submission_recorded",
  "followup_recorded",
  "publication_requested",
  "moderation_decided",
  "report_published",
  "publication_withdrawn",
  "response_added",
  "report_closed",
  "report_reopened",
  "flow_error_shown",
]);
export type EventName = z.infer<typeof EventName>;

/** Per-event property schemas (additional to the shared envelope). */
export const EventProperties = {
  demo_entered: z.object({ entry_role: z.enum(["reporter", "reviewer"]) }),
  feed_viewed: z.object({ result_count: z.number().int().nonnegative() }),
  feed_search_completed: z.object({
    result_count: z.number().int().nonnegative(),
  }),
  feed_report_viewed: z.object({
    report_id: z.string().uuid(),
    publication_revision_id: z.string().uuid(),
    source: z.enum(["feed", "search", "direct"]),
  }),
  report_started: z.object({
    flow_id: z.string().uuid(),
    source: z.enum(["feed", "detail", "my_reports"]),
    linked_product: z.boolean(),
  }),
  report_saved: z.object({
    flow_id: z.string().uuid(),
    report_id: z.string().uuid(),
    is_first_save: z.boolean(),
    evidence_complete: z.boolean(),
  }),
  evidence_uploaded: z.object({
    report_id: z.string().uuid(),
    evidence_id: z.string().uuid(),
    purpose: z.enum(["label", "acknowledgement", "response"]),
  }),
  facts_confirmed: z.object({
    report_id: z.string().uuid(),
    method: z.enum(["manual", "assisted"]),
  }),
  complaint_draft_saved: z.object({
    report_id: z.string().uuid(),
    draft_id: z.string().uuid(),
    channel: Channel,
    method: z.enum(["template", "assisted"]),
  }),
  complaint_text_copied: z.object({
    report_id: z.string().uuid(),
    channel: Channel,
  }),
  official_channel_opened: z.object({
    report_id: z.string().uuid(),
    destination_key: z.string(),
  }),
  brand_email_opened: z.object({ report_id: z.string().uuid() }),
  submission_recorded: z.object({
    report_id: z.string().uuid(),
    submission_id: z.string().uuid(),
    channel: Channel,
    has_acknowledgement: z.boolean(),
    provenance: z.literal("user_recorded"),
  }),
  followup_recorded: z.object({
    report_id: z.string().uuid(),
    submission_id: z.string().uuid(),
    followup_id: z.string().uuid(),
    channel: Channel,
  }),
  publication_requested: z.object({
    report_id: z.string().uuid(),
    publication_revision_id: z.string().uuid(),
    content_kind: ContentKind,
  }),
  moderation_decided: z.object({
    report_id: z.string().uuid(),
    publication_revision_id: z.string().uuid(),
    decision: ModerationDecision,
    content_kind: ContentKind,
  }),
  report_published: z.object({
    report_id: z.string().uuid(),
    publication_revision_id: z.string().uuid(),
  }),
  publication_withdrawn: z.object({
    report_id: z.string().uuid(),
    publication_revision_id: z.string().uuid(),
  }),
  response_added: z.object({
    report_id: z.string().uuid(),
    submission_id: z.string().uuid(),
    response_id: z.string().uuid(),
    channel: Channel,
    has_attachment: z.boolean(),
  }),
  report_closed: z.object({ report_id: z.string().uuid() }),
  report_reopened: z.object({ report_id: z.string().uuid() }),
  flow_error_shown: z.object({
    operation: z.enum([
      "load",
      "save",
      "upload",
      "prepare_draft",
      "handoff",
      "publish",
      "moderate",
    ]),
    error_code: z.enum(["network", "validation", "unavailable", "unknown"]),
  }),
} as const;

/**
 * The events a BROWSER may report through `POST /api/analytics`: views, copies,
 * handoffs and displayed errors. Every other event in the dictionary records a
 * persisted action and is emitted by the server after commit
 * (lib/server/analytics-events.ts); the proxy refuses them from a client so a
 * browser can never claim a save, a publication or a moderation decision
 * (FOODPROOF_API_DETAILS.md "Analytics", FOODPROOF_TECHNICAL_SPEC.md §9).
 */
export const CLIENT_OWNED_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "demo_entered",
  "feed_viewed",
  "feed_search_completed",
  "feed_report_viewed",
  "report_started",
  "complaint_text_copied",
  "official_channel_opened",
  "brand_email_opened",
  "flow_error_shown",
]);

/** What a client is allowed to POST to /api/analytics (server owns the envelope). */
export const ClientAnalyticsEventRequest = z
  .object({
    event_name: EventName,
    event_id: z.string().uuid(),
    // A real ISO 8601 timestamp (UTC). The endpoint additionally rejects values
    // outside a freshness window (lib/server/analytics-rate-limit.ts).
    occurred_at: z.string().datetime(),
    properties: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ClientAnalyticsEventRequest = z.infer<
  typeof ClientAnalyticsEventRequest
>;
