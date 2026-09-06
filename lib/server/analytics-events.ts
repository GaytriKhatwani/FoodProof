import "server-only";
import { z } from "zod";
import type {
  Channel,
  ComplaintDraft,
  DecisionAction,
  EvidenceMeta,
  ReportDetail,
  ReportUpdate,
  ReviewRequestState,
  Submission,
} from "@/lib/contracts";
import { FLOW_ID_HEADER } from "@/lib/client/api";
import type { ServerEvent } from "./analytics";
import type {
  DecisionResult,
  FlagResolveResult,
  RemoveResult,
  WithdrawResult,
} from "./publication";

/**
 * Pure builders that turn a committed service result into the server-owned
 * analytics events for that route (FOODPROOF_MEASUREMENT_AND_PILOT.md §4).
 *
 * They are deliberately free of I/O so each route stays a single line and the
 * dictionary mapping — including every "emit nothing" case — is fully unit
 * tested. `occurred_at` always comes from a PERSISTED timestamp in the result,
 * never `Date.now()`: a replayed idempotent retry then reproduces the identical
 * deduplication tuple. Anything that is not in the dictionary returns null/[]
 * rather than an invented event.
 */

const Uuid = z.string().uuid();

/**
 * The `X-Flow-Id` correlation header sent by the report editor. It is analytics
 * metadata, never a stored field. An absent or malformed value means we cannot
 * honestly report `report_saved.flow_id`, so NOTHING is emitted for that save —
 * a fabricated flow id would corrupt the first-save funnel denominator.
 */
export function parseFlowId(headers: Headers): string | null {
  const parsed = Uuid.safeParse(headers.get(FLOW_ID_HEADER));
  return parsed.success ? parsed.data : null;
}

/**
 * `report_saved.evidence_complete`: the report's own ready label evidence covers
 * identity, claim AND ingredients — the same three roles publication requires
 * (lib/server/preparation.ts). Derived from the detail the route already has, so
 * no extra query runs on the mutation path.
 */
export function evidenceComplete(detail: Pick<ReportDetail, "evidence">): boolean {
  const covered = new Set<string>();
  for (const item of detail.evidence) {
    if (item.kind !== "label" || item.upload_state !== "ready") continue;
    for (const role of item.roles) covered.add(role);
  }
  return covered.has("identity") && covered.has("claim") && covered.has("ingredients");
}

/** `POST /api/reports` and `PATCH /api/reports/:id` → `report_saved`. */
export function reportSavedEvent(
  detail: ReportDetail,
  flowId: string | null,
  isFirstSave: boolean,
): ServerEvent | null {
  if (!flowId) return null;
  return {
    event_name: "report_saved",
    occurred_at: detail.updated_at,
    properties: {
      flow_id: flowId,
      report_id: detail.report_id,
      is_first_save: isFirstSave,
      evidence_complete: evidenceComplete(detail),
    },
  };
}

/** `POST /api/reports/:id/confirm-facts` → `facts_confirmed`. */
export function factsConfirmedEvent(
  detail: ReportDetail,
  method: "manual" | "assisted",
): ServerEvent | null {
  if (!detail.facts_confirmed_at) return null;
  return {
    event_name: "facts_confirmed",
    occurred_at: detail.facts_confirmed_at,
    properties: { report_id: detail.report_id, method },
  };
}

/**
 * `POST /api/reports/:id/evidence` → `evidence_uploaded`. Evidence kind
 * `receipt` maps to NO event: the optional receipt metric is deliberately
 * omitted (FOODPROOF_TECHNICAL_SPEC.md §9).
 */
export function evidenceUploadedEvent(
  reportId: string,
  evidence: EvidenceMeta,
): ServerEvent | null {
  if (evidence.kind === "receipt") return null;
  return {
    event_name: "evidence_uploaded",
    occurred_at: evidence.created_at,
    properties: {
      report_id: reportId,
      evidence_id: evidence.id,
      purpose: evidence.kind,
    },
  };
}

/** `PUT /api/reports/:id/complaint-drafts/:channel` → `complaint_draft_saved`. */
export function complaintDraftSavedEvent(
  reportId: string,
  draft: ComplaintDraft,
): ServerEvent {
  return {
    event_name: "complaint_draft_saved",
    occurred_at: draft.updated_at,
    properties: {
      report_id: reportId,
      draft_id: draft.id,
      channel: draft.channel,
      method: draft.method,
    },
  };
}

/** `POST /api/reports/:id/submissions` → `submission_recorded`. */
export function submissionRecordedEvent(
  reportId: string,
  submission: Submission,
): ServerEvent {
  return {
    event_name: "submission_recorded",
    occurred_at: submission.created_at,
    properties: {
      report_id: reportId,
      submission_id: submission.id,
      channel: submission.channel,
      has_acknowledgement: submission.has_acknowledgement,
      provenance: "user_recorded",
    },
  };
}

/**
 * `POST /api/reports/:id/updates` → `followup_recorded` or `response_added`.
 * `channel` is the linked submission's channel (the update itself has none).
 * Closure/reopen updates are written by the lifecycle routes and are measured
 * there, so any other kind emits nothing.
 */
export function updateRecordedEvent(
  reportId: string,
  update: ReportUpdate,
  channel: Channel,
): ServerEvent | null {
  if (!update.submission_id) return null;
  if (update.kind === "follow_up") {
    return {
      event_name: "followup_recorded",
      occurred_at: update.created_at,
      properties: {
        report_id: reportId,
        submission_id: update.submission_id,
        followup_id: update.id,
        channel,
      },
    };
  }
  if (update.kind === "response") {
    return {
      event_name: "response_added",
      occurred_at: update.created_at,
      properties: {
        report_id: reportId,
        submission_id: update.submission_id,
        response_id: update.id,
        channel,
        has_attachment: update.has_attachment,
      },
    };
  }
  return null;
}

/** `POST /api/reports/:id/close` and `/reopen` → the matching transition event. */
export function lifecycleEvent(
  detail: ReportDetail,
  transition: "closed" | "reopened",
): ServerEvent {
  return {
    event_name: transition === "closed" ? "report_closed" : "report_reopened",
    occurred_at: detail.updated_at,
    properties: { report_id: detail.report_id },
  };
}

/** `POST /api/reports/:id/publication-requests` → `publication_requested`. */
export function publicationRequestedEvent(
  reportId: string,
  result: ReviewRequestState,
): ServerEvent {
  return {
    event_name: "publication_requested",
    occurred_at: result.created_at,
    properties: {
      report_id: reportId,
      publication_revision_id: result.publication_revision_id,
      content_kind: result.content_kind,
    },
  };
}

/**
 * `POST /api/reports/:id/withdraw` → `publication_withdrawn`, ONLY when the call
 * actually removed feed visibility. Withdrawing a report that was never visible
 * (or already hidden) matches no dictionary trigger and must not be counted.
 */
export function publicationWithdrawnEvent(result: WithdrawResult): ServerEvent | null {
  if (!result.hidden || !result.publication_revision_id) return null;
  return {
    event_name: "publication_withdrawn",
    occurred_at: result.withdrawn_at,
    properties: {
      report_id: result.report_id,
      publication_revision_id: result.publication_revision_id,
    },
  };
}

/** Stored revision state -> the analytics moderation enum. */
const DECISION_FOR_STATE: Partial<
  Record<ReviewRequestState["state"], "approved" | "changes_requested" | "rejected">
> = {
  approved: "approved",
  changes_requested: "changes_requested",
  rejected: "rejected",
};

/**
 * `POST /api/review/:revisionId/decision` → `moderation_decided`, plus
 * `report_published` when an approval makes a CONCERN feed-visible. A response
 * approval is reported through `moderation_decided` with
 * `content_kind=response` only — it never publishes a new concern
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md §4). The actor is the reviewer, and the
 * report is joined by `report_id`, not by the reviewer's analytics identity.
 */
export function decisionEvents(
  result: DecisionResult,
  action: DecisionAction,
): ServerEvent[] {
  const decision = DECISION_FOR_STATE[result.state];
  if (!decision) return [];
  const events: ServerEvent[] = [
    {
      event_name: "moderation_decided",
      occurred_at: result.reviewed_at,
      properties: {
        report_id: result.report_id,
        publication_revision_id: result.publication_revision_id,
        decision,
        content_kind: result.content_kind,
      },
    },
  ];
  if (action === "approve" && result.content_kind === "concern") {
    events.push({
      event_name: "report_published",
      occurred_at: result.reviewed_at,
      properties: {
        report_id: result.report_id,
        publication_revision_id: result.publication_revision_id,
      },
    });
  }
  return events;
}

/**
 * `POST /api/review/reports/:id/remove` → `moderation_decided` with
 * `decision: "removed"`, only when a published concern revision was actually
 * hidden. Removing a report with nothing visible reports nothing.
 */
export function removalEvent(result: RemoveResult): ServerEvent | null {
  if (!result.publication_revision_id || !result.removed_at) return null;
  return {
    event_name: "moderation_decided",
    occurred_at: result.removed_at,
    properties: {
      report_id: result.report_id,
      publication_revision_id: result.publication_revision_id,
      decision: "removed",
      content_kind: "concern",
    },
  };
}

/**
 * `POST /api/review/flags/:id/resolve` → the same removal event, and only when
 * the resolution actually removed published content. Resolving a flag without
 * removing anything has no dictionary event.
 */
export function flagResolutionEvent(result: FlagResolveResult): ServerEvent | null {
  if (!result.removed) return null;
  return removalEvent({
    report_id: result.report_id,
    removed: true,
    publication_revision_id: result.publication_revision_id,
    removed_at: result.removed_at,
  });
}
