import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  FlagRequest,
  PublicExternalStatus,
  PublicationRequest,
  RelinkRequest,
  ReviewDecisionRequest,
  ReviewRequestState,
} from "@/lib/contracts";
import { ApiError, mapRpcError } from "./errors";
import { getServiceClient } from "./supabase";
import { loadOwnedReport } from "./data";
import { evidenceStorage } from "./storage";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";

/**
 * Publication and moderation (FOODPROOF_TECHNICAL_SPEC.md §5,
 * FOODPROOF_API_DETAILS.md). A publication request freezes an immutable,
 * allowlisted payload plus sanitized asset copies built from OWNED data — never
 * a client-supplied public payload.
 *
 * Every operation that would otherwise leave a contradictory public projection
 * halfway through runs as ONE database transaction, in the `fp_*` functions of
 * `supabase/migrations/0003_transactional_operations.sql`: approval (revision
 * state + publication pointer + audit, refusing a stale approval that would
 * resurrect hidden content), withdrawal, reviewer removal, flag resolution with
 * removal, and relinking. Ownership and the reviewer role are still checked here
 * before the call, and again inside the function. If 0003 is not applied the
 * call fails loudly naming the migration — there is no silent fallback to the
 * old step-by-step path.
 */

interface ConcernPayload {
  report_id: string;
  product_id: string | null;
  product_name: string;
  brand: string;
  variant: string | null;
  concern_summary: string;
  confirmed_claim_text: string | null;
  confirmed_ingredients_text: string | null;
  observation_date: string | null;
  external_status: {
    brand: PublicExternalStatus;
    government: PublicExternalStatus;
    as_recorded_at: string | null;
  };
}

interface ResponsePayload {
  channel: Channel;
  summary: string;
  occurred_at: string;
  has_attachment: boolean;
  provenance: "user_recorded";
}

const STALE = () =>
  new ApiError("CONFLICT", "This changed since you loaded it. Reload and retry.");

/** Enforce the reviewer role from the stored record (not the route alone). */
async function assertReviewer(supabase: SupabaseClient, accessId: string): Promise<void> {
  const { data, error } = await supabase
    .from("demo_access")
    .select("role")
    .eq("id", accessId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.role !== "reviewer") {
    throw new ApiError("FORBIDDEN", "Reviewer access is required.");
  }
}

/** Freeze the reviewed per-channel external status from owned history. */
export async function computeExternalStatus(
  supabase: SupabaseClient,
  reportId: string,
): Promise<ConcernPayload["external_status"]> {
  const { data: subs, error: sErr } = await supabase
    .from("submissions")
    .select("id, channel, submitted_at, acknowledgement_evidence_id")
    .eq("report_id", reportId);
  if (sErr) throw sErr;
  const { data: resp, error: rErr } = await supabase
    .from("updates")
    .select("submission_id, occurred_at")
    .eq("report_id", reportId)
    .eq("kind", "response");
  if (rErr) throw rErr;

  const responded = new Set((resp ?? []).map((r) => r.submission_id));
  const dates: string[] = [];

  const statusFor = (channel: Channel): PublicExternalStatus => {
    const chSubs = (subs ?? []).filter((s) => s.channel === channel);
    if (chSubs.length === 0) return "no_submission_recorded";
    let status: PublicExternalStatus = "submission_reported";
    for (const s of chSubs) {
      dates.push(s.submitted_at);
      if (s.acknowledgement_evidence_id && status === "submission_reported") {
        status = "acknowledgement_attached";
      }
      if (responded.has(s.id)) status = "response_reported";
    }
    return status;
  };

  const brand = statusFor("brand");
  const government = statusFor("government");
  for (const r of resp ?? []) dates.push(r.occurred_at);
  const asRecorded = dates.length ? dates.sort().at(-1)! : null;
  return { brand, government, as_recorded_at: asRecorded };
}

async function nextRevision(supabase: SupabaseClient, reportId: string): Promise<number> {
  const { data, error } = await supabase
    .from("publication_revisions")
    .select("revision")
    .eq("report_id", reportId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.revision ?? 0) + 1;
}

/**
 * Validate the selected evidence and return its private object paths. This runs
 * BEFORE any revision row is written, so a rejected selection leaves nothing
 * behind: previously the revision was inserted first, and a validation failure
 * left an orphan pending request that blocked the owner's next attempt.
 */
async function validateSelectedEvidence(
  supabase: SupabaseClient,
  reportId: string,
  evidenceIds: string[],
  requireLabel: boolean,
): Promise<{ evidenceId: string; objectPath: string }[]> {
  const selected: { evidenceId: string; objectPath: string }[] = [];
  for (const evId of evidenceIds) {
    const { data: ev, error } = await supabase
      .from("evidence")
      .select("object_path, kind, upload_state, mime_type, report_id")
      .eq("id", evId)
      .maybeSingle();
    if (error) throw error;
    if (!ev || ev.report_id !== reportId) {
      throw new ApiError("VALIDATION_FAILED", "Selected evidence does not belong to this report.");
    }
    if (ev.upload_state !== "ready") {
      throw new ApiError("VALIDATION_FAILED", "Selected evidence is not ready.");
    }
    if (requireLabel && ev.kind !== "label") {
      throw new ApiError("VALIDATION_FAILED", "Concern assets must be label images.");
    }
    if (!String(ev.mime_type).startsWith("image/")) {
      throw new ApiError("VALIDATION_FAILED", "Only images can be published as assets.");
    }
    selected.push({ evidenceId: evId, objectPath: ev.object_path as string });
  }
  return selected;
}

/** Build sanitized reviewed asset copies for already-validated evidence. */
async function freezeAssets(
  supabase: SupabaseClient,
  revisionId: string,
  selected: { evidenceId: string; objectPath: string }[],
): Promise<void> {
  for (const item of selected) {
    const reviewed = await evidenceStorage.putReviewedCopy(item.objectPath);
    const { error: insErr } = await supabase.from("publication_assets").insert({
      revision_id: revisionId,
      source_evidence_id: item.evidenceId,
      object_path: reviewed.objectPath,
    });
    if (insErr) throw insErr;
  }
}

export function requestPublication(
  accessId: string,
  reportId: string,
  body: PublicationRequest,
  idempotencyKey: string,
): Promise<ReviewRequestState> {
  return withReceipt(
    accessId,
    "publication.request",
    idempotencyKey,
    { reportId, body },
    () =>
      body.source_update_id
        ? requestResponseRevision(accessId, reportId, body)
        : requestConcernRevision(accessId, reportId, body),
  );
}

async function requestConcernRevision(
  accessId: string,
  reportId: string,
  body: PublicationRequest,
): Promise<ReviewRequestState> {
  const supabase = getServiceClient();
  const report = await loadOwnedReport(accessId, reportId, supabase);
  if (body.expected_version !== report.version) throw STALE();
  if (report.preparation !== "ready") {
    throw new ApiError(
      "VALIDATION_FAILED",
      "Confirm facts and add identity, claim and ingredient photos before publishing.",
    );
  }

  const { data: pending, error: pErr } = await supabase
    .from("publication_revisions")
    .select("id")
    .eq("report_id", reportId)
    .is("source_update_id", null)
    .eq("state", "pending_review")
    .limit(1);
  if (pErr) throw pErr;
  if ((pending ?? []).length > 0) {
    throw new ApiError("CONFLICT", "A review request is already pending for this concern.");
  }

  // A concern revision always needs at least one image (label roles). This is
  // enforced here independently of the request schema, since server functions
  // are also called directly (e.g. from tests) without going through the HTTP
  // validation layer.
  if (body.selected_evidence_ids.length === 0) {
    throw new ApiError("VALIDATION_FAILED", "Select at least one image.");
  }

  // Validate the selection before anything is persisted.
  const selected = await validateSelectedEvidence(
    supabase,
    reportId,
    body.selected_evidence_ids,
    true,
  );

  const payload: ConcernPayload = {
    report_id: reportId,
    product_id: report.product_id,
    product_name: report.product_name,
    brand: report.brand,
    variant: report.variant,
    concern_summary: report.concern_text ?? "",
    confirmed_claim_text: report.claim_text,
    confirmed_ingredients_text: report.ingredients_text,
    observation_date: report.observation_date,
    external_status: await computeExternalStatus(supabase, reportId),
  };

  const revision = await nextRevision(supabase, reportId);
  const { data: rev, error } = await supabase
    .from("publication_revisions")
    .insert({
      report_id: reportId,
      source_update_id: null,
      revision,
      payload,
      consented_at: new Date().toISOString(),
      requested_by: accessId,
      state: "pending_review",
      version: 0,
    })
    .select("id, state, revision, created_at")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError("CONFLICT", "A review request is already pending for this concern.");
    }
    throw error;
  }

  await freezeAssets(supabase, rev.id, selected);
  await recordEvent({
    reportId,
    actorAccessId: accessId,
    type: "publication_requested",
    relatedEntityId: rev.id,
    metadata: { content_kind: "concern" },
  });

  return {
    publication_revision_id: rev.id,
    content_kind: "concern",
    state: rev.state,
    reason: null,
    revision: rev.revision,
    created_at: rev.created_at,
  };
}

async function requestResponseRevision(
  accessId: string,
  reportId: string,
  body: PublicationRequest,
): Promise<ReviewRequestState> {
  const supabase = getServiceClient();
  const report = await loadOwnedReport(accessId, reportId, supabase);
  if (body.expected_version !== report.version) throw STALE();

  // Parent concern must be published and visible.
  const { data: pub, error: pubErr } = await supabase
    .from("publications")
    .select("visible")
    .eq("report_id", reportId)
    .maybeSingle();
  if (pubErr) throw pubErr;
  if (!pub || !pub.visible) {
    throw new ApiError("CONFLICT", "Publish the concern before adding a response.");
  }

  const sourceUpdateId = body.source_update_id as string;
  const { data: update, error: uErr } = await supabase
    .from("updates")
    .select("id, report_id, kind, sender, occurred_at, summary, submission_id, evidence_id")
    .eq("id", sourceUpdateId)
    .maybeSingle();
  if (uErr) throw uErr;
  if (!update || update.report_id !== reportId || update.kind !== "response") {
    throw new ApiError("VALIDATION_FAILED", "source_update_id must be a recorded response on this report.");
  }
  if (!update.sender) {
    throw new ApiError("VALIDATION_FAILED", "The response must have a sender.");
  }

  const { data: pending, error: pendErr } = await supabase
    .from("publication_revisions")
    .select("id")
    .eq("source_update_id", sourceUpdateId)
    .eq("state", "pending_review")
    .limit(1);
  if (pendErr) throw pendErr;
  if ((pending ?? []).length > 0) {
    throw new ApiError("CONFLICT", "A review request is already pending for this response.");
  }

  // Channel comes from the linked submission.
  let channel: Channel = "brand";
  if (update.submission_id) {
    const { data: sub } = await supabase
      .from("submissions")
      .select("channel")
      .eq("id", update.submission_id)
      .maybeSingle();
    if (sub?.channel) channel = sub.channel as Channel;
  }

  // Response images are optional and not required to cover label roles, but the
  // selection is still validated before anything is persisted.
  const selected = await validateSelectedEvidence(
    supabase,
    reportId,
    body.selected_evidence_ids,
    false,
  );

  const payload: ResponsePayload = {
    channel,
    summary: update.summary,
    occurred_at: update.occurred_at,
    has_attachment: body.selected_evidence_ids.length > 0,
    provenance: "user_recorded",
  };

  const revision = await nextRevision(supabase, reportId);
  const { data: rev, error } = await supabase
    .from("publication_revisions")
    .insert({
      report_id: reportId,
      source_update_id: sourceUpdateId,
      revision,
      payload,
      consented_at: new Date().toISOString(),
      requested_by: accessId,
      state: "pending_review",
      version: 0,
    })
    .select("id, state, revision, created_at")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new ApiError("CONFLICT", "A review request is already pending for this response.");
    }
    throw error;
  }

  await freezeAssets(supabase, rev.id, selected);
  await recordEvent({
    reportId,
    actorAccessId: accessId,
    type: "publication_requested",
    relatedEntityId: rev.id,
    metadata: { content_kind: "response" },
  });

  return {
    publication_revision_id: rev.id,
    content_kind: "response",
    state: rev.state,
    reason: null,
    revision: rev.revision,
    created_at: rev.created_at,
  };
}

export function withdrawPublication(
  accessId: string,
  reportId: string,
  idempotencyKey: string,
): Promise<{ report_id: string; withdrawn: true }> {
  return withReceipt(accessId, "publication.withdraw", idempotencyKey, { reportId }, async () => {
    const supabase = getServiceClient();
    await loadOwnedReport(accessId, reportId, supabase);

    // One transaction hides the publication, withdraws the approved concern and
    // its dependent approved responses, cancels anything still in review, and
    // records the audit event — so no pending revision survives to be approved.
    const { error } = await supabase.rpc("fp_withdraw_publication", {
      p_report_id: reportId,
      p_actor: accessId,
    });
    if (error) throw mapRpcError("fp_withdraw_publication", error);
    return { report_id: reportId, withdrawn: true };
  });
}

export function decideReview(
  reviewerAccessId: string,
  revisionId: string,
  body: ReviewDecisionRequest,
  idempotencyKey: string,
): Promise<ReviewRequestState> {
  return withReceipt(
    reviewerAccessId,
    "review.decision",
    idempotencyKey,
    { revisionId, body },
    async () => {
      const supabase = getServiceClient();
      await assertReviewer(supabase, reviewerAccessId);

      const needsReason = body.action === "request_changes" || body.action === "reject";
      if (needsReason && !body.reason) {
        throw new ApiError("VALIDATION_FAILED", "A reason is required for this decision.");
      }

      // One transaction performs the decision, the publication-pointer move and
      // the audit event, under the same optimistic version/state guards. It
      // refuses an approval of a revision that predates a withdrawal or removal,
      // so a stale approval can never resurrect hidden content.
      const { data, error } = await supabase.rpc("fp_decide_review", {
        p_revision_id: revisionId,
        p_reviewer: reviewerAccessId,
        p_expected_version: body.expected_version,
        p_action: body.action,
        p_reason: body.reason ?? null,
      });
      if (error) throw mapRpcError("fp_decide_review", error);
      const row = data as DecisionRow;

      return {
        publication_revision_id: row.publication_revision_id,
        content_kind: row.source_update_id ? "response" : "concern",
        state: row.state,
        reason: row.reason ?? null,
        revision: row.revision,
        created_at: row.created_at,
      };
    },
  );
}

/** Row shape returned by `fp_decide_review` (migration 0003). */
interface DecisionRow {
  publication_revision_id: string;
  source_update_id: string | null;
  state: ReviewRequestState["state"];
  reason: string | null;
  revision: number;
  created_at: string;
}

export function removeContent(
  reviewerAccessId: string,
  reportId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ report_id: string; removed: true }> {
  return withReceipt(reviewerAccessId, "review.remove", idempotencyKey, { reportId, reason }, async () => {
    const supabase = getServiceClient();
    await assertReviewer(supabase, reviewerAccessId);
    // Hiding the publication, cancelling every still-approvable revision and
    // writing the moderation audit event happen in one transaction.
    const { error } = await supabase.rpc("fp_remove_content", {
      p_report_id: reportId,
      p_reviewer: reviewerAccessId,
      p_reason: reason,
    });
    if (error) throw mapRpcError("fp_remove_content", error);
    return { report_id: reportId, removed: true };
  });
}

export function relinkProduct(
  reviewerAccessId: string,
  reportId: string,
  body: RelinkRequest,
  idempotencyKey: string,
): Promise<{ report_id: string; product_id: string }> {
  return withReceipt(reviewerAccessId, "review.relink", idempotencyKey, { reportId, body }, async () => {
    const supabase = getServiceClient();
    await assertReviewer(supabase, reviewerAccessId);
    // The product change and the log that explains it are one unit: a moderator
    // action never lands without its audit record.
    const { error } = await supabase.rpc("fp_relink_product", {
      p_report_id: reportId,
      p_reviewer: reviewerAccessId,
      p_product_id: body.product_id,
      p_reason: body.reason,
    });
    if (error) throw mapRpcError("fp_relink_product", error);
    return { report_id: reportId, product_id: body.product_id };
  });
}

export function raiseFlag(
  accessId: string,
  reportId: string,
  body: FlagRequest,
  idempotencyKey: string,
): Promise<{ flag_id: string }> {
  return withReceipt(accessId, "flag.create", idempotencyKey, { reportId, body }, async () => {
    const supabase = getServiceClient();
    // Only flag a report that is currently visible in the feed.
    const { data: pub, error } = await supabase
      .from("publications")
      .select("visible")
      .eq("report_id", reportId)
      .maybeSingle();
    if (error) throw error;
    if (!pub || !pub.visible) throw new ApiError("NOT_FOUND", "Concern not found.");

    const { data: flag, error: fErr } = await supabase
      .from("content_flags")
      .insert({
        report_id: reportId,
        requested_by: accessId,
        reason: body.detail ? `${body.reason}: ${body.detail}` : body.reason,
        state: "open",
      })
      .select("id")
      .single();
    if (fErr) throw fErr;

    await recordEvent({
      reportId,
      actorAccessId: accessId,
      type: "flag_raised",
      relatedEntityId: flag.id,
    });
    return { flag_id: flag.id };
  });
}

export function resolveFlag(
  reviewerAccessId: string,
  flagId: string,
  opts: { note?: string; remove?: boolean },
  idempotencyKey: string,
): Promise<{ flag_id: string; state: "handled" }> {
  return withReceipt(reviewerAccessId, "flag.resolve", idempotencyKey, { flagId, opts }, async () => {
    const supabase = getServiceClient();
    await assertReviewer(supabase, reviewerAccessId);
    // Resolving the flag and (optionally) removing the content are one unit, so
    // a handled flag can never point at content that is still published.
    const { error } = await supabase.rpc("fp_resolve_flag", {
      p_flag_id: flagId,
      p_reviewer: reviewerAccessId,
      p_note: opts.note ?? null,
      p_remove: Boolean(opts.remove),
    });
    if (error) throw mapRpcError("fp_resolve_flag", error);
    return { flag_id: flagId, state: "handled" };
  });
}
