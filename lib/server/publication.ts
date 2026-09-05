import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  DecisionAction,
  FlagRequest,
  PublicExternalStatus,
  PublicationRequest,
  RelinkRequest,
  ReviewDecisionRequest,
  ReviewRequestState,
} from "@/lib/contracts";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { loadOwnedReport } from "./data";
import { evidenceStorage } from "./storage";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";

/**
 * Publication and moderation (FOODPROOF_TECHNICAL_SPEC.md §5,
 * FOODPROOF_API_DETAILS.md). A publication request freezes an immutable,
 * allowlisted payload plus sanitized asset copies built from OWNED data — never
 * a client-supplied public payload. Approval updates the revision state and the
 * publication pointer together under an optimistic guard, so a stale or repeated
 * approval cannot resurrect withdrawn/removed content. Withdrawing or removing a
 * parent hides all of its responses and assets.
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

/** Build sanitized reviewed asset copies for the selected evidence. */
async function freezeAssets(
  supabase: SupabaseClient,
  reportId: string,
  revisionId: string,
  evidenceIds: string[],
  requireLabel: boolean,
): Promise<void> {
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
    const reviewed = await evidenceStorage.putReviewedCopy(ev.object_path as string);
    const { error: insErr } = await supabase.from("publication_assets").insert({
      revision_id: revisionId,
      source_evidence_id: evId,
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

  await freezeAssets(supabase, reportId, rev.id, body.selected_evidence_ids, true);
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

  // Response images are optional and not required to cover label roles.
  await freezeAssets(supabase, reportId, rev.id, body.selected_evidence_ids, false);
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

    // Hide the publication and mark the approved concern revision withdrawn.
    const { data: pub, error: pubErr } = await supabase
      .from("publications")
      .select("approved_revision_id, visible")
      .eq("report_id", reportId)
      .maybeSingle();
    if (pubErr) throw pubErr;
    if (pub && pub.visible) {
      const { error: hideErr } = await supabase
        .from("publications")
        .update({ visible: false, hidden_at: new Date().toISOString() })
        .eq("report_id", reportId);
      if (hideErr) throw hideErr;
      await supabase
        .from("publication_revisions")
        .update({ state: "withdrawn" })
        .eq("id", pub.approved_revision_id);
    }

    // Invalidate any pending approval requests for this report.
    const { error: cancelErr } = await supabase
      .from("publication_revisions")
      .update({ state: "withdrawn" })
      .eq("report_id", reportId)
      .eq("state", "pending_review");
    if (cancelErr) throw cancelErr;

    await recordEvent({ reportId, actorAccessId: accessId, type: "publication_withdrawn" });
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
      const { data: rev, error } = await supabase
        .from("publication_revisions")
        .select("id, report_id, source_update_id, state, version")
        .eq("id", revisionId)
        .maybeSingle();
      if (error) throw error;
      if (!rev) throw new ApiError("NOT_FOUND", "Review request not found.");
      if (rev.state !== "pending_review") {
        throw new ApiError("CONFLICT", "This request has already been decided.");
      }
      if (body.expected_version !== rev.version) throw STALE();

      const needsReason = body.action === "request_changes" || body.action === "reject";
      if (needsReason && !body.reason) {
        throw new ApiError("VALIDATION_FAILED", "A reason is required for this decision.");
      }
      const nextState = mapAction(body.action);

      // Guarded state transition (prevents stale/repeated approval).
      const { data: updated, error: uErr } = await supabase
        .from("publication_revisions")
        .update({
          state: nextState,
          reviewed_by: reviewerAccessId,
          reviewed_at: new Date().toISOString(),
          reason: body.reason ?? null,
          version: rev.version + 1,
        })
        .eq("id", revisionId)
        .eq("version", rev.version)
        .eq("state", "pending_review")
        .select("id, state, revision, reason, created_at, source_update_id");
      if (uErr) throw uErr;
      const row = updated?.[0];
      if (!row) throw STALE();

      // Approving a concern revision moves the publication pointer atomically-ish.
      if (body.action === "approve" && !rev.source_update_id) {
        const { error: pErr } = await supabase.from("publications").upsert(
          {
            report_id: rev.report_id,
            approved_revision_id: revisionId,
            visible: true,
            approved_at: new Date().toISOString(),
            hidden_at: null,
          },
          { onConflict: "report_id" },
        );
        if (pErr) throw pErr;
      }

      await recordEvent({
        reportId: rev.report_id,
        actorAccessId: reviewerAccessId,
        type:
          body.action === "approve"
            ? "review_approved"
            : body.action === "request_changes"
              ? "review_changes_requested"
              : "review_rejected",
        relatedEntityId: revisionId,
        metadata: body.reason ? { reason: body.reason } : null,
      });

      return {
        publication_revision_id: row.id,
        content_kind: row.source_update_id ? "response" : "concern",
        state: row.state,
        reason: row.reason ?? null,
        revision: row.revision,
        created_at: row.created_at,
      };
    },
  );
}

function mapAction(action: DecisionAction): "approved" | "changes_requested" | "rejected" {
  switch (action) {
    case "approve":
      return "approved";
    case "request_changes":
      return "changes_requested";
    case "reject":
      return "rejected";
  }
}

/** Hide a publication and mark its revisions removed. Caller enforces reviewer. */
async function removeContentCore(
  supabase: SupabaseClient,
  reviewerAccessId: string,
  reportId: string,
  reason: string,
): Promise<void> {
  const { data: report, error } = await supabase
    .from("reports")
    .select("id")
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw error;
  if (!report) throw new ApiError("NOT_FOUND", "Report not found.");

  await supabase
    .from("publications")
    .update({ visible: false, hidden_at: new Date().toISOString() })
    .eq("report_id", reportId);
  // Mark approved/pending revisions removed; cancels pending approvals too.
  await supabase
    .from("publication_revisions")
    .update({ state: "removed" })
    .eq("report_id", reportId)
    .in("state", ["approved", "pending_review", "changes_requested"]);

  await recordEvent({
    reportId,
    actorAccessId: reviewerAccessId,
    type: "content_removed",
    metadata: { reason },
  });
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
    await removeContentCore(supabase, reviewerAccessId, reportId, reason);
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
    const { data: report, error } = await supabase
      .from("reports")
      .select("id, product_id")
      .eq("id", reportId)
      .maybeSingle();
    if (error) throw error;
    if (!report) throw new ApiError("NOT_FOUND", "Report not found.");

    const { data: product, error: prodErr } = await supabase
      .from("products")
      .select("id")
      .eq("id", body.product_id)
      .maybeSingle();
    if (prodErr) throw prodErr;
    if (!product) throw new ApiError("VALIDATION_FAILED", "Target product not found.");

    const { error: upErr } = await supabase
      .from("reports")
      .update({ product_id: body.product_id })
      .eq("id", reportId);
    if (upErr) throw upErr;

    await recordEvent({
      reportId,
      actorAccessId: reviewerAccessId,
      type: "product_relinked",
      metadata: { from: report.product_id, to: body.product_id, reason: body.reason },
    });
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
    const { data: flag, error } = await supabase
      .from("content_flags")
      .select("id, report_id, state")
      .eq("id", flagId)
      .maybeSingle();
    if (error) throw error;
    if (!flag) throw new ApiError("NOT_FOUND", "Flag not found.");

    if (opts.remove) {
      await removeContentCore(
        supabase,
        reviewerAccessId,
        flag.report_id,
        opts.note ?? "Removed after flag review.",
      );
    }
    const { error: uErr } = await supabase
      .from("content_flags")
      .update({ state: "handled", reviewer_note: opts.note ?? null })
      .eq("id", flagId);
    if (uErr) throw uErr;

    await recordEvent({
      reportId: flag.report_id,
      actorAccessId: reviewerAccessId,
      type: "flag_resolved",
      relatedEntityId: flagId,
      metadata: opts.note ? { note: opts.note } : null,
    });
    return { flag_id: flagId, state: "handled" };
  });
}
