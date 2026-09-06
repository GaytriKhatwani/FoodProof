import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Channel,
  ReportDetail,
  ReportUpdate,
  Submission,
  SubmissionCreateRequest,
  UpdateCreateRequest,
} from "@/lib/contracts";
import { ApiError, mapRpcError } from "./errors";
import { getServiceClient } from "./supabase";
import { getOwnReport, loadOwnedReport } from "./data";
import { recordEvent } from "./audit";
import { withReceipt } from "./idempotency";

/**
 * External history and reporter lifecycle (FOODPROOF_TECHNICAL_SPEC.md §4/§6).
 * Submissions, responses and follow-ups are always user-recorded — the app makes
 * no external claim. Attachments must belong to the same report; dates cannot be
 * set in the future; closure/reopen append an audit update atomically.
 */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertNotFuture(date: string, field: string): void {
  if (date > today()) {
    throw new ApiError("VALIDATION_FAILED", "Date cannot be in the future.", {
      fields: { [field]: "Not a future date." },
    });
  }
}

async function assertEvidenceBelongs(
  supabase: SupabaseClient,
  reportId: string,
  evidenceId: string,
  allowedKinds?: string[],
): Promise<void> {
  const { data, error } = await supabase
    .from("evidence")
    .select("report_id, kind")
    .eq("id", evidenceId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.report_id !== reportId) {
    throw new ApiError("VALIDATION_FAILED", "Attachment does not belong to this report.");
  }
  if (allowedKinds && !allowedKinds.includes(data.kind)) {
    throw new ApiError("VALIDATION_FAILED", `Attachment must be of kind: ${allowedKinds.join(", ")}.`);
  }
}

async function assertSubmissionBelongs(
  supabase: SupabaseClient,
  reportId: string,
  submissionId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("submissions")
    .select("report_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.report_id !== reportId) {
    throw new ApiError("VALIDATION_FAILED", "Submission does not belong to this report.");
  }
}

function mapSubmission(s: Record<string, unknown>): Submission {
  return {
    id: s.id as string,
    channel: s.channel as Submission["channel"],
    recipient: s.recipient as string,
    submitted_at: s.submitted_at as string,
    reference: (s.reference as string | null) ?? null,
    has_acknowledgement: Boolean(s.acknowledgement_evidence_id),
    created_at: s.created_at as string,
  };
}

function mapUpdate(u: Record<string, unknown>): ReportUpdate {
  return {
    id: u.id as string,
    submission_id: (u.submission_id as string | null) ?? null,
    kind: u.kind as ReportUpdate["kind"],
    sender: (u.sender as string | null) ?? null,
    occurred_at: u.occurred_at as string,
    summary: u.summary as string,
    has_attachment: Boolean(u.evidence_id),
    created_at: u.created_at as string,
  };
}

/**
 * The channel of a submission that belongs to this report, or null when there is
 * none. An update carries no channel of its own, so the server-owned
 * `followup_recorded` / `response_added` events read it from here rather than
 * running a query inside a route handler.
 */
export async function submissionChannel(
  reportId: string,
  submissionId: string,
): Promise<Channel | null> {
  const { data, error } = await getServiceClient()
    .from("submissions")
    .select("channel, report_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.report_id !== reportId) return null;
  return data.channel as Channel;
}

export async function recordSubmission(
  accessId: string,
  reportId: string,
  body: SubmissionCreateRequest,
  idempotencyKey: string,
): Promise<Submission> {
  return withReceipt(
    accessId,
    "submission.create",
    idempotencyKey,
    { reportId, body },
    async () => {
      const supabase = getServiceClient();
      await loadOwnedReport(accessId, reportId, supabase);
      assertNotFuture(body.submitted_at, "submitted_at");
      if (body.acknowledgement_evidence_id) {
        await assertEvidenceBelongs(supabase, reportId, body.acknowledgement_evidence_id, [
          "acknowledgement",
        ]);
      }
      const { data, error } = await supabase
        .from("submissions")
        .insert({
          report_id: reportId,
          channel: body.channel,
          recipient: body.recipient,
          submitted_at: body.submitted_at,
          reference: body.reference ?? null,
          acknowledgement_evidence_id: body.acknowledgement_evidence_id ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "submission_recorded",
        relatedEntityId: data.id,
        metadata: { channel: body.channel },
      });
      return mapSubmission(data);
    },
  );
}

export async function recordUpdate(
  accessId: string,
  reportId: string,
  body: UpdateCreateRequest,
  idempotencyKey: string,
): Promise<ReportUpdate> {
  return withReceipt(
    accessId,
    "update.create",
    idempotencyKey,
    { reportId, body },
    async () => {
      const supabase = getServiceClient();
      await loadOwnedReport(accessId, reportId, supabase);
      assertNotFuture(body.occurred_at, "occurred_at");

      if (!body.submission_id) {
        throw new ApiError("VALIDATION_FAILED", "submission_id is required for this update.");
      }
      await assertSubmissionBelongs(supabase, reportId, body.submission_id);
      if (body.kind === "response" && !body.sender) {
        throw new ApiError("VALIDATION_FAILED", "sender is required for a response.");
      }
      if (body.evidence_id) {
        await assertEvidenceBelongs(supabase, reportId, body.evidence_id);
      }

      const { data, error } = await supabase
        .from("updates")
        .insert({
          report_id: reportId,
          submission_id: body.submission_id,
          kind: body.kind,
          sender: body.sender ?? null,
          occurred_at: body.occurred_at,
          summary: body.summary,
          evidence_id: body.evidence_id ?? null,
          actor_access_id: accessId,
        })
        .select("*")
        .single();
      if (error) throw error;
      await recordEvent({
        reportId,
        actorAccessId: accessId,
        type: "update_recorded",
        relatedEntityId: data.id,
        metadata: { kind: body.kind },
      });
      return mapUpdate(data);
    },
  );
}

/**
 * Close/reopen in ONE transaction (`fp_set_lifecycle`, migration 0003): the
 * timeline entry, the lifecycle change and the audit event land together.
 * Previously the timeline row was inserted first, so a failed or stale lifecycle
 * update left a "closed" entry on a report that is still open.
 */
async function setLifecycle(
  accessId: string,
  reportId: string,
  to: "open" | "closed_by_reporter",
  auditKind: "closed" | "reopened",
  summary: string,
  closeReason: string | null,
): Promise<ReportDetail> {
  const supabase = getServiceClient();
  await loadOwnedReport(accessId, reportId, supabase);

  const { error } = await supabase.rpc("fp_set_lifecycle", {
    p_report_id: reportId,
    p_owner: accessId,
    p_to: to,
    p_audit_kind: auditKind,
    p_summary: summary,
    p_close_reason: closeReason,
  });
  if (error) throw mapRpcError("fp_set_lifecycle", error);

  return getOwnReport(accessId, reportId, supabase);
}

export function closeReport(
  accessId: string,
  reportId: string,
  reason: string,
  idempotencyKey: string,
): Promise<ReportDetail> {
  return withReceipt(accessId, "report.close", idempotencyKey, { reportId, reason }, () =>
    setLifecycle(accessId, reportId, "closed_by_reporter", "closed", reason, reason),
  );
}

export function reopenReport(
  accessId: string,
  reportId: string,
  idempotencyKey: string,
): Promise<ReportDetail> {
  return withReceipt(accessId, "report.reopen", idempotencyKey, { reportId }, () =>
    setLifecycle(accessId, reportId, "open", "reopened", "Reopened by reporter.", null),
  );
}
