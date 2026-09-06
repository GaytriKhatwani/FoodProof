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
import { ApiError, MIGRATION_0004, mapRpcError } from "./errors";
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
 * `supabase/migrations/0003_transactional_operations.sql` and
 * `0004_publication_atomicity_and_ai_spend.sql`: the publication request itself
 * (revision + frozen asset rows + audit, re-guarded under the report lock),
 * approval (revision state + publication pointer + audit, refusing a stale
 * approval that would resurrect hidden content), withdrawal, reviewer removal,
 * flag resolution with removal, and relinking. Ownership and the reviewer role
 * are still checked here before the call, and again inside the function. If a
 * migration is not applied the call fails loudly naming it — there is no silent
 * fallback to the old step-by-step path.
 *
 * Storage writes cannot join a database transaction. A request therefore
 * uploads the sanitized copies FIRST and only then calls the transaction: a
 * Storage failure leaves no revision at all, and a database failure leaves only
 * orphaned reviewed objects (deleted best-effort below) — never a pending,
 * approvable revision with fewer assets than the reporter selected.
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

/**
 * Validate the selected evidence and return its private object paths. This runs
 * BEFORE any Storage upload or database write, so a rejected selection leaves
 * nothing behind. The transaction re-checks the same facts under the report
 * lock; this pass exists to fail early and cheaply with a precise message.
 */
/** The three label roles a concern snapshot must collectively show. */
const REQUIRED_CONCERN_ROLES = ["identity", "claim", "ingredients"] as const;

/** Error message shared with `fp_request_publication` so all layers agree. */
const CONCERN_COVERAGE_MESSAGE =
  "The selected photos must together show the product identity, the gluten-free (or relevant) claim, and the ingredients.";

async function validateSelectedEvidence(
  supabase: SupabaseClient,
  reportId: string,
  evidenceIds: string[],
  requireLabel: boolean,
): Promise<{ evidenceId: string; objectPath: string }[]> {
  const selected: { evidenceId: string; objectPath: string }[] = [];
  const coveredRoles = new Set<string>();
  for (const evId of evidenceIds) {
    const { data: ev, error } = await supabase
      .from("evidence")
      .select("object_path, kind, upload_state, mime_type, report_id, roles")
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
    for (const role of (ev.roles as string[] | null) ?? []) coveredRoles.add(role);
    selected.push({ evidenceId: evId, objectPath: ev.object_path as string });
  }
  // A concern snapshot must collectively cover identity, claim and ingredients.
  // This mirrors the authoritative check inside fp_request_publication so the
  // request fails early with a precise message; the database remains the final
  // authority under the report lock.
  if (requireLabel && !REQUIRED_CONCERN_ROLES.every((role) => coveredRoles.has(role))) {
    throw new ApiError("VALIDATION_FAILED", CONCERN_COVERAGE_MESSAGE);
  }
  return selected;
}

/** Row shape returned by `fp_request_publication` (migration 0004). */
interface RequestRow {
  publication_revision_id: string;
  content_kind: "concern" | "response";
  state: ReviewRequestState["state"];
  reason: string | null;
  revision: number;
  created_at: string;
}

interface FrozenAsset {
  source_evidence_id: string;
  object_path: string;
}

/**
 * Delete reviewed copies that no committed revision references. Called when the
 * transaction failed after some copies were uploaded. If the transaction DID
 * commit but its response was lost, the rows exist and the objects are kept —
 * a lost reply must never strip images from a real pending request.
 */
export async function removeOrphanedCopies(
  supabase: Pick<SupabaseClient, "from">,
  frozen: FrozenAsset[],
  storage: Pick<typeof evidenceStorage, "removeObject"> = evidenceStorage,
): Promise<void> {
  if (frozen.length === 0) return;
  const paths = frozen.map((f) => f.object_path);
  // supabase-js reports a failed lookup as `{ data: null, error }` — it does
  // NOT throw — so the error must be checked explicitly. If we cannot tell
  // whether a committed revision references these objects, keep them: an orphan
  // is harmless, a missing asset on a committed revision is not.
  const { data, error } = await supabase
    .from("publication_assets")
    .select("object_path")
    .in("object_path", paths);
  if (error) return;
  const referenced = new Set((data ?? []).map((a) => a.object_path as string));
  await Promise.all(
    paths
      .filter((p) => !referenced.has(p))
      .map((p) => storage.removeObject(p).catch(() => undefined)),
  );
}

/**
 * Upload sanitized copies, then commit the request in one transaction. Any
 * failure before the transaction returns leaves no pending revision.
 */
async function freezeAndRequest(
  supabase: SupabaseClient,
  args: {
    accessId: string;
    reportId: string;
    sourceUpdateId: string | null;
    expectedVersion: number;
    payload: ConcernPayload | ResponsePayload;
    selected: { evidenceId: string; objectPath: string }[];
  },
): Promise<ReviewRequestState> {
  const frozen: FrozenAsset[] = [];
  try {
    // 1. Storage first. Nothing in the database points at these yet.
    for (const item of args.selected) {
      const reviewed = await evidenceStorage.putReviewedCopy(item.objectPath);
      frozen.push({ source_evidence_id: item.evidenceId, object_path: reviewed.objectPath });
    }

    // 2. One transaction: every guard under the report lock, the revision, its
    //    asset rows and the audit event — all or nothing.
    const { data, error } = await supabase.rpc("fp_request_publication", {
      p_report_id: args.reportId,
      p_actor: args.accessId,
      p_source_update_id: args.sourceUpdateId,
      p_expected_version: args.expectedVersion,
      p_payload: args.payload,
      p_assets: frozen,
    });
    if (error) throw mapRpcError("fp_request_publication", error, MIGRATION_0004);
    const row = data as RequestRow;
    return {
      publication_revision_id: row.publication_revision_id,
      content_kind: row.content_kind,
      source_update_id: args.sourceUpdateId,
      state: row.state,
      reason: row.reason ?? null,
      revision: row.revision,
      created_at: row.created_at,
    };
  } catch (e) {
    await removeOrphanedCopies(supabase, frozen);
    throw e;
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
  if (body.expected_version === null || body.expected_version !== report.version) throw STALE();
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

  // Validate the selection before anything is uploaded or persisted.
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

  return freezeAndRequest(supabase, {
    accessId,
    reportId,
    sourceUpdateId: null,
    expectedVersion: body.expected_version,
    payload,
    selected,
  });
}

async function requestResponseRevision(
  accessId: string,
  reportId: string,
  body: PublicationRequest,
): Promise<ReviewRequestState> {
  const supabase = getServiceClient();
  const report = await loadOwnedReport(accessId, reportId, supabase);
  if (body.expected_version === null || body.expected_version !== report.version) throw STALE();

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
  // selection is still validated before anything is uploaded or persisted.
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

  return freezeAndRequest(supabase, {
    accessId,
    reportId,
    sourceUpdateId,
    expectedVersion: body.expected_version,
    payload,
    selected,
  });
}

/** Result of a withdrawal; additive fields feed the server-owned analytics event. */
export interface WithdrawResult {
  report_id: string;
  withdrawn: true;
  /** True when a visible publication was hidden by this call. */
  hidden: boolean;
  /** The approved concern revision that was hidden, or null when nothing was visible. */
  publication_revision_id: string | null;
  withdrawn_at: string;
}

export function withdrawPublication(
  accessId: string,
  reportId: string,
  idempotencyKey: string,
): Promise<WithdrawResult> {
  return withReceipt(accessId, "publication.withdraw", idempotencyKey, { reportId }, async () => {
    const supabase = getServiceClient();
    await loadOwnedReport(accessId, reportId, supabase);

    // One transaction hides the publication, withdraws the approved concern and
    // its dependent approved responses, cancels anything still in review, and
    // records the audit event — so no pending revision survives to be approved.
    const { data, error } = await supabase.rpc("fp_withdraw_publication", {
      p_report_id: reportId,
      p_actor: accessId,
    });
    if (error) throw mapRpcError("fp_withdraw_publication", error);
    const row = (data ?? {}) as Partial<WithdrawResult>;
    if (typeof row.hidden !== "boolean" || typeof row.withdrawn_at !== "string") {
      throw new ApiError(
        "DEPENDENCY_UNAVAILABLE",
        `fp_withdraw_publication() returned an older shape. Apply ${MIGRATION_0004} to this Supabase project.`,
      );
    }
    return {
      report_id: reportId,
      withdrawn: true,
      hidden: row.hidden,
      publication_revision_id: row.publication_revision_id ?? null,
      withdrawn_at: row.withdrawn_at,
    };
  });
}

/** Decision result: the request state plus what the analytics event needs. */
export type DecisionResult = ReviewRequestState & {
  report_id: string;
  reviewed_at: string;
};

export function decideReview(
  reviewerAccessId: string,
  revisionId: string,
  body: ReviewDecisionRequest,
  idempotencyKey: string,
): Promise<DecisionResult> {
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
      if (typeof row.report_id !== "string" || typeof row.reviewed_at !== "string") {
        throw new ApiError(
          "DEPENDENCY_UNAVAILABLE",
          `fp_decide_review() returned an older shape. Apply ${MIGRATION_0004} to this Supabase project.`,
        );
      }

      return {
        publication_revision_id: row.publication_revision_id,
        report_id: row.report_id,
        content_kind: row.source_update_id ? "response" : "concern",
        source_update_id: row.source_update_id ?? null,
        state: row.state,
        reason: row.reason ?? null,
        revision: row.revision,
        created_at: row.created_at,
        reviewed_at: row.reviewed_at,
      };
    },
  );
}

/** Row shape returned by `fp_decide_review` (migrations 0003 + 0004). */
interface DecisionRow {
  publication_revision_id: string;
  report_id: string;
  source_update_id: string | null;
  state: ReviewRequestState["state"];
  reason: string | null;
  revision: number;
  created_at: string;
  reviewed_at: string;
}

/** Result of a reviewer removal; additive fields feed the analytics event. */
export interface RemoveResult {
  report_id: string;
  removed: true;
  /** The approved revision that was hidden, or null when nothing was visible. */
  publication_revision_id: string | null;
  removed_at: string | null;
}

export function removeContent(
  reviewerAccessId: string,
  reportId: string,
  reason: string,
  idempotencyKey: string,
): Promise<RemoveResult> {
  return withReceipt(reviewerAccessId, "review.remove", idempotencyKey, { reportId, reason }, async () => {
    const supabase = getServiceClient();
    await assertReviewer(supabase, reviewerAccessId);
    // Hiding the publication, cancelling every still-approvable revision and
    // writing the moderation audit event happen in one transaction.
    const { data, error } = await supabase.rpc("fp_remove_content", {
      p_report_id: reportId,
      p_reviewer: reviewerAccessId,
      p_reason: reason,
    });
    if (error) throw mapRpcError("fp_remove_content", error);
    const row = (data ?? {}) as Partial<RemoveResult>;
    if (typeof row.removed_at !== "string") {
      throw new ApiError(
        "DEPENDENCY_UNAVAILABLE",
        `fp_remove_content() returned an older shape. Apply ${MIGRATION_0004} to this Supabase project.`,
      );
    }
    return {
      report_id: reportId,
      removed: true,
      publication_revision_id: row.publication_revision_id ?? null,
      removed_at: row.removed_at ?? null,
    };
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

/** Result of a flag resolution; additive fields feed the analytics event. */
export interface FlagResolveResult {
  flag_id: string;
  state: "handled";
  report_id: string;
  /** True when the resolution also removed the published content. */
  removed: boolean;
  publication_revision_id: string | null;
  removed_at: string | null;
}

export function resolveFlag(
  reviewerAccessId: string,
  flagId: string,
  opts: { note?: string; remove?: boolean },
  idempotencyKey: string,
): Promise<FlagResolveResult> {
  return withReceipt(reviewerAccessId, "flag.resolve", idempotencyKey, { flagId, opts }, async () => {
    const supabase = getServiceClient();
    await assertReviewer(supabase, reviewerAccessId);
    // Resolving the flag and (optionally) removing the content are one unit, so
    // a handled flag can never point at content that is still published.
    const { data, error } = await supabase.rpc("fp_resolve_flag", {
      p_flag_id: flagId,
      p_reviewer: reviewerAccessId,
      p_note: opts.note ?? null,
      p_remove: Boolean(opts.remove),
    });
    if (error) throw mapRpcError("fp_resolve_flag", error);
    const row = (data ?? {}) as Partial<FlagResolveResult>;
    if (typeof row.report_id !== "string") {
      throw new ApiError(
        "DEPENDENCY_UNAVAILABLE",
        `fp_resolve_flag() returned an older shape. Apply ${MIGRATION_0004} to this Supabase project.`,
      );
    }
    return {
      flag_id: flagId,
      state: "handled",
      report_id: row.report_id,
      removed: Boolean(row.removed),
      publication_revision_id: row.publication_revision_id ?? null,
      removed_at: row.removed_at ?? null,
    };
  });
}
