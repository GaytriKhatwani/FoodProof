import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ReportWriteRequest } from "@/lib/contracts";
import { ApiError } from "@/lib/server/errors";
import { createReport, confirmFacts } from "@/lib/server/reports";
import { addEvidence } from "@/lib/server/evidence";
import { prepareDraft, saveComplaintDraft } from "@/lib/server/drafts";
import {
  closeReport,
  recordSubmission,
  recordUpdate,
  reopenReport,
} from "@/lib/server/history";
import { getOwnReport } from "@/lib/server/data";
import {
  cleanupStorage,
  createAccess,
  deleteAccess,
  liveDescribe,
  samplePng,
  testClient,
} from "../helpers/live";

/**
 * Complaint drafts, external history and reporter lifecycle
 * (FOODPROOF_TECHNICAL_SPEC.md §4/§6/§8, FOODPROOF_API_DETAILS.md).
 */
liveDescribe("drafts + external history (live Supabase)", () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdReports: string[] = [];

  afterAll(async () => {
    await cleanupStorage(client, createdReports);
    await deleteAccess(client, createdAccess);
  });

  const baseReport = (): ReportWriteRequest => ({
    product_name: "Sample Pantry Crackers",
    brand: "Sample Pantry",
    variant: null,
    concern_text: "Label claims gluten-free but lists wheat.",
    claim_text: null,
    ingredients_text: null,
    expected_version: null,
  });

  async function readyReport(): Promise<{ reportId: string; accessId: string }> {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId);
    const report = await createReport(a.accessId, baseReport(), randomUUID());
    createdReports.push(report.report_id);
    await confirmFacts(
      a.accessId,
      report.report_id,
      { expected_version: 0, claim_text: "Gluten-free", ingredients_text: "Wheat flour", method: "manual" },
      randomUUID(),
    );
    return { reportId: report.report_id, accessId: a.accessId };
  }

  async function expectApiError(p: Promise<unknown>): Promise<ApiError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    }
    throw new Error("expected an ApiError");
  }

  it("prepares a template only after facts are confirmed", async () => {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId);
    const report = await createReport(a.accessId, baseReport(), randomUUID());
    createdReports.push(report.report_id);

    const err = await expectApiError(prepareDraft(a.accessId, report.report_id, "government"));
    expect(err.code).toBe("VALIDATION_FAILED");

    await confirmFacts(
      a.accessId,
      report.report_id,
      { expected_version: 0, claim_text: "Gluten-free", ingredients_text: "Wheat flour", method: "manual" },
      randomUUID(),
    );
    const draft = await prepareDraft(a.accessId, report.report_id, "government");
    expect(draft.method).toBe("template");
    expect(draft.subject).toContain("Sample Pantry");
    expect(draft.body).toMatch(/SAMPLE|DEMONSTRATION/i); // must warn not to send for real
  });

  it("saves a per-channel draft with optimistic concurrency", async () => {
    const { reportId, accessId } = await readyReport();

    const created = await saveComplaintDraft(
      accessId,
      reportId,
      "brand",
      { subject: "S1", body: "B1", method: "template", expected_version: null },
      randomUUID(),
    );
    expect(created.version).toBe(0);

    const updated = await saveComplaintDraft(
      accessId,
      reportId,
      "brand",
      { subject: "S2", body: "B2", method: "template", expected_version: 0 },
      randomUUID(),
    );
    expect(updated.version).toBe(1);
    expect(updated.id).toBe(created.id);

    const stale = await expectApiError(
      saveComplaintDraft(
        accessId,
        reportId,
        "brand",
        { subject: "S3", body: "B3", method: "template", expected_version: 0 },
        randomUUID(),
      ),
    );
    expect(stale.code).toBe("CONFLICT");
  });

  it("records a submission, rejects a future date and a foreign attachment", async () => {
    const { reportId, accessId } = await readyReport();

    const submission = await recordSubmission(
      accessId,
      reportId,
      { channel: "government", recipient: "Food Safety Connect", submitted_at: "2026-09-01" },
      randomUUID(),
    );
    expect(submission.channel).toBe("government");
    expect(submission.has_acknowledgement).toBe(false);

    const future = await expectApiError(
      recordSubmission(
        accessId,
        reportId,
        { channel: "brand", recipient: "X", submitted_at: "2999-01-01" },
        randomUUID(),
      ),
    );
    expect(future.code).toBe("VALIDATION_FAILED");
  });

  it("records a response requiring sender and a matching submission", async () => {
    const { reportId, accessId } = await readyReport();
    const submission = await recordSubmission(
      accessId,
      reportId,
      { channel: "brand", recipient: "Sample Pantry care", submitted_at: "2026-09-01" },
      randomUUID(),
    );

    // Response without a sender is rejected.
    const noSender = await expectApiError(
      recordUpdate(
        accessId,
        reportId,
        { submission_id: submission.id, kind: "response", occurred_at: "2026-09-02", summary: "Replied" },
        randomUUID(),
      ),
    );
    expect(noSender.code).toBe("VALIDATION_FAILED");

    const response = await recordUpdate(
      accessId,
      reportId,
      {
        submission_id: submission.id,
        kind: "response",
        sender: "Sample Pantry",
        occurred_at: "2026-09-02",
        summary: "They acknowledged the concern.",
      },
      randomUUID(),
    );
    expect(response.kind).toBe("response");
    expect(response.sender).toBe("Sample Pantry");
  });

  it("closes and reopens a report, appending audit updates", async () => {
    const { reportId, accessId } = await readyReport();

    const closed = await closeReport(accessId, reportId, "Resolved to my satisfaction.", randomUUID());
    expect(closed.lifecycle).toBe("closed_by_reporter");
    expect(closed.close_reason).toContain("Resolved");
    expect(closed.updates.some((u) => u.kind === "closed")).toBe(true);

    // Double close conflicts.
    const again = await expectApiError(
      closeReport(accessId, reportId, "again", randomUUID()),
    );
    expect(again.code).toBe("CONFLICT");

    const reopened = await reopenReport(accessId, reportId, randomUUID());
    expect(reopened.lifecycle).toBe("open");
    expect(reopened.close_reason).toBeNull();
    expect(reopened.updates.some((u) => u.kind === "reopened")).toBe(true);
  });

  it("links an acknowledgement attachment that belongs to the report", async () => {
    const { reportId, accessId } = await readyReport();

    const ack = await addEvidence(
      accessId,
      reportId,
      { kind: "acknowledgement", roles: [] },
      { bytes: samplePng() },
      randomUUID(),
    );
    const submission = await recordSubmission(
      accessId,
      reportId,
      {
        channel: "government",
        recipient: "Food Safety Connect",
        submitted_at: "2026-09-01",
        acknowledgement_evidence_id: ack.id,
      },
      randomUUID(),
    );
    expect(submission.has_acknowledgement).toBe(true);

    const detail = await getOwnReport(accessId, reportId);
    expect(detail.submissions).toHaveLength(1);
    expect(detail.submissions[0]?.has_acknowledgement).toBe(true);
  });
});
