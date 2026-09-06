import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ReportWriteRequest } from "@/lib/contracts";
import { ApiError } from "@/lib/server/errors";
import { createReport, confirmFacts } from "@/lib/server/reports";
import { addEvidence } from "@/lib/server/evidence";
import { recordSubmission, recordUpdate } from "@/lib/server/history";
import { evidenceStorage } from "@/lib/server/storage";
import {
  decideReview,
  raiseFlag,
  removeContent,
  requestPublication,
  resolveFlag,
  withdrawPublication,
} from "@/lib/server/publication";
import {
  getFeed,
  getOwnReport,
  getPublicReport,
  getReviewDetail,
  getReviewQueue,
  readPublicationAssetForMedia,
} from "@/lib/server/data";
import {
  cleanupStorage,
  createAccess,
  deleteAccess,
  liveSuite,
  samplePng,
  testClient,
} from "../helpers/live";

/**
 * Publication, moderation, feed and flags (FOODPROOF_TECHNICAL_SPEC.md §5,
 * FOODPROOF_API_DETAILS.md): exact-snapshot approval, reviewer-only decisions,
 * withdrawal/removal hiding responses and assets, no stale resurrection, and the
 * public projection carrying no owner-linked fields.
 *
 * Approval, withdrawal, removal, flag resolution and relinking now run inside
 * the transactional functions of migration 0003, so this suite reports BLOCKED
 * (skipped, with the reason in its name) until that migration is applied to the
 * demo project. A blocked suite proves nothing.
 */
const publicationSuite = await liveSuite("publication + moderation (live Supabase)", {
  requiresSchema: 4,
});

publicationSuite.run(publicationSuite.title, () => {
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

  async function newUser() {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId);
    return a.accessId;
  }
  async function newReviewer() {
    const a = await createAccess(client, { role: "reviewer", label: "reviewer@foodproof" });
    createdAccess.push(a.accessId);
    return a.accessId;
  }

  /** A report that satisfies the concern publication preconditions. */
  async function readyReport(accessId: string) {
    const report = await createReport(accessId, baseReport(), randomUUID());
    createdReports.push(report.report_id);
    await confirmFacts(
      accessId,
      report.report_id,
      { expected_version: 0, claim_text: "Gluten-free", ingredients_text: "Wheat flour", method: "manual" },
      randomUUID(),
    );
    const ev = await addEvidence(
      accessId,
      report.report_id,
      { kind: "label", roles: ["identity", "claim", "ingredients"] },
      { bytes: samplePng() },
      randomUUID(),
    );
    const detail = await getOwnReport(accessId, report.report_id);
    return { reportId: report.report_id, evidenceId: ev.id, version: detail.version };
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

  it("publishes the exact snapshot only via a reviewer, then shows it in the feed", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const { reportId, evidenceId, version } = await readyReport(owner);

    const req = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );
    expect(req.content_kind).toBe("concern");
    expect(req.state).toBe("pending_review");

    // Reviewer sees the queued case and the exact frozen snapshot.
    const queue = await getReviewQueue();
    const queued = queue.items.find((i) => i.publication_revision_id === req.publication_revision_id);
    expect(queued).toBeDefined();
    expect(queued?.brand).toBe("Sample Pantry");
    expect(queued?.product_name).toBe("Sample Pantry Crackers");
    const detail = await getReviewDetail(req.publication_revision_id);
    expect((detail.payload as { brand: string }).brand).toBe("Sample Pantry");
    expect(detail.asset_ids).toHaveLength(1);
    expect(detail.version).toBe(0);

    // A tester cannot approve by direct service call (role enforced server-side).
    const forbidden = await expectApiError(
      decideReview(
        owner,
        req.publication_revision_id,
        { expected_version: detail.version, action: "approve" },
        randomUUID(),
      ),
    );
    expect(forbidden.code).toBe("FORBIDDEN");

    // Reviewer approves the exact snapshot.
    const decided = await decideReview(
      reviewer,
      req.publication_revision_id,
      { expected_version: detail.version, action: "approve" },
      randomUUID(),
    );
    expect(decided.state).toBe("approved");

    // Appears in the feed with the frozen values and an anonymous author label.
    const feed = await getFeed({});
    const item = feed.items.find((i) => i.report_id === reportId);
    expect(item?.brand).toBe("Sample Pantry");
    expect(item?.concern_summary).toContain("gluten-free");
    expect(item?.author_label).toBe("Anonymous contributor");

    // Public detail exposes confirmed facts + guarded asset ids, no owner leak.
    const pub = await getPublicReport(reportId);
    expect(pub.confirmed_claim_text).toBe("Gluten-free");
    expect(pub.approved_asset_ids).toHaveLength(1);
    expect(Object.keys(pub)).not.toContain("owner_access_id");
    expect(JSON.stringify(pub)).not.toContain("demo-originals");

    // Owner visibility reflects publication.
    const ownerView = await getOwnReport(owner, reportId);
    expect(ownerView.community_visibility).toBe("published");

    // A repeated approval cannot re-decide.
    const repeat = await expectApiError(
      decideReview(reviewer, req.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID()),
    );
    expect(repeat.code).toBe("CONFLICT");
  });

  it("requires a reason to reject", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const { reportId, evidenceId, version } = await readyReport(owner);
    const req = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );

    const noReason = await expectApiError(
      decideReview(reviewer, req.publication_revision_id, { expected_version: 0, action: "reject" }, randomUUID()),
    );
    expect(noReason.code).toBe("VALIDATION_FAILED");

    const rejected = await decideReview(
      reviewer,
      req.publication_revision_id,
      { expected_version: 0, action: "reject", reason: "Contains personal information." },
      randomUUID(),
    );
    expect(rejected.state).toBe("rejected");
    const ownerView = await getOwnReport(owner, reportId);
    expect(ownerView.community_visibility).toBe("rejected");
  });

  it("attaches an approved response and hides it when the parent is withdrawn", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const { reportId, evidenceId, version } = await readyReport(owner);

    const concern = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );
    await decideReview(reviewer, concern.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const submission = await recordSubmission(
      owner,
      reportId,
      { channel: "brand", recipient: "Sample Pantry care", submitted_at: "2026-09-01" },
      randomUUID(),
    );
    const response = await recordUpdate(
      owner,
      reportId,
      { submission_id: submission.id, kind: "response", sender: "Sample Pantry", occurred_at: "2026-09-02", summary: "We are reviewing the label." },
      randomUUID(),
    );

    const v = (await getOwnReport(owner, reportId)).version;
    const respReq = await requestPublication(
      owner,
      reportId,
      { expected_version: v, consent: true, selected_evidence_ids: [evidenceId], source_update_id: response.id },
      randomUUID(),
    );
    expect(respReq.content_kind).toBe("response");

    // A response revision's own snapshot carries no product identity, so the
    // queue falls back to the owning report's brand/product_name.
    const respQueue = await getReviewQueue();
    const queuedResp = respQueue.items.find(
      (i) => i.publication_revision_id === respReq.publication_revision_id,
    );
    expect(queuedResp?.brand).toBe("Sample Pantry");
    expect(queuedResp?.product_name).toBe("Sample Pantry Crackers");

    await decideReview(reviewer, respReq.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const withResp = await getPublicReport(reportId);
    expect(withResp.responses).toHaveLength(1);
    expect(withResp.responses[0]?.channel).toBe("brand");
    expect(withResp.responses[0]?.summary).toContain("reviewing");

    // Withdraw the parent: feed, detail and the response all disappear.
    await withdrawPublication(owner, reportId, randomUUID());
    const feed = await getFeed({});
    expect(feed.items.find((i) => i.report_id === reportId)).toBeUndefined();
    const gone = await expectApiError(getPublicReport(reportId));
    expect(gone.code).toBe("NOT_FOUND");
    expect((await getOwnReport(owner, reportId)).community_visibility).toBe("withdrawn");

    // A stale approval on the withdrawn concern cannot resurrect it.
    const resurrect = await expectApiError(
      decideReview(reviewer, concern.publication_revision_id, { expected_version: 1, action: "approve" }, randomUUID()),
    );
    expect(resurrect.code).toBe("CONFLICT");
  });

  it("handles flags and reviewer removal", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const flagger = await newUser();
    const { reportId, evidenceId, version } = await readyReport(owner);
    const req = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );
    await decideReview(reviewer, req.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const flag = await raiseFlag(flagger, reportId, { reason: "Looks inaccurate" }, randomUUID());
    const queue = await getReviewQueue();
    expect(queue.flags.some((f) => f.id === flag.flag_id)).toBe(true);

    // Resolving with removal hides the content and handles the flag.
    await resolveFlag(reviewer, flag.flag_id, { remove: true, note: "Removed pending correction." }, randomUUID());
    const gone = await expectApiError(getPublicReport(reportId));
    expect(gone.code).toBe("NOT_FOUND");
    expect((await getOwnReport(owner, reportId)).community_visibility).toBe("removed");
  });

  it("refuses a response revision when the concern is not published", async () => {
    const owner = await newUser();
    const { reportId } = await readyReport(owner);
    const submission = await recordSubmission(
      owner,
      reportId,
      { channel: "government", recipient: "Food Safety Connect", submitted_at: "2026-09-01" },
      randomUUID(),
    );
    const response = await recordUpdate(
      owner,
      reportId,
      { submission_id: submission.id, kind: "response", sender: "FSC", occurred_at: "2026-09-02", summary: "Noted." },
      randomUUID(),
    );
    const v = (await getOwnReport(owner, reportId)).version;
    const err = await expectApiError(
      requestPublication(
        owner,
        reportId,
        { expected_version: v, consent: true, selected_evidence_ids: [], source_update_id: response.id },
        randomUUID(),
      ),
    );
    // A response revision may select no images; the missing published parent
    // is what conflicts here.
    expect(err.code).toBe("CONFLICT");
  });

  it("requests and approves a response revision with no attachment", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const { reportId, evidenceId, version } = await readyReport(owner);

    const concern = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );
    await decideReview(reviewer, concern.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const submission = await recordSubmission(
      owner,
      reportId,
      { channel: "government", recipient: "Food Safety Connect", submitted_at: "2026-09-01" },
      randomUUID(),
    );
    const response = await recordUpdate(
      owner,
      reportId,
      { submission_id: submission.id, kind: "response", sender: "FSC", occurred_at: "2026-09-02", summary: "The agency logged the complaint." },
      randomUUID(),
    );

    const v = (await getOwnReport(owner, reportId)).version;
    const respReq = await requestPublication(
      owner,
      reportId,
      { expected_version: v, consent: true, selected_evidence_ids: [], source_update_id: response.id },
      randomUUID(),
    );
    expect(respReq.content_kind).toBe("response");

    const detail = await getReviewDetail(respReq.publication_revision_id);
    expect(detail.asset_ids).toHaveLength(0);

    await decideReview(reviewer, respReq.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const pub = await getPublicReport(reportId);
    const resp = pub.responses.find((r) => r.publication_revision_id === respReq.publication_revision_id);
    expect(resp).toBeDefined();
    expect(resp?.has_attachment).toBe(false);
    expect(pub.approved_asset_ids).toHaveLength(1); // only the concern's own label image
  });

  it("rejects a concern revision with no selected images", async () => {
    const owner = await newUser();
    const { reportId, version } = await readyReport(owner);
    const err = await expectApiError(
      requestPublication(
        owner,
        reportId,
        { expected_version: version, consent: true, selected_evidence_ids: [] },
        randomUUID(),
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
  });

  // -------------------------------------------------------------------------
  // Carry-over integrity risks fixed at T4 (migration 0004).
  // -------------------------------------------------------------------------

  it("a Storage failure while freezing leaves no pending revision, and the retry succeeds", async () => {
    const owner = await newUser();
    const { reportId, evidenceId, version } = await readyReport(owner);
    // A second selected image so the outage can hit AFTER one copy landed.
    const second = await addEvidence(
      owner,
      reportId,
      { kind: "label", roles: ["claim"] },
      { bytes: samplePng() },
      randomUUID(),
    );
    const v = (await getOwnReport(owner, reportId)).version;
    expect(v).toBe(version + 1);

    const original = evidenceStorage.putReviewedCopy;
    const spy = vi
      .spyOn(evidenceStorage, "putReviewedCopy")
      .mockImplementationOnce((path) => original.call(evidenceStorage, path))
      .mockRejectedValueOnce(new Error("simulated storage outage"));

    const key = randomUUID();
    const body = {
      expected_version: v,
      consent: true as const,
      selected_evidence_ids: [evidenceId, second.id],
    };
    await expect(requestPublication(owner, reportId, body, key)).rejects.toThrow(
      /simulated storage outage/,
    );
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();

    // Nothing approvable was written: no revision, no asset rows, and the one
    // copy that did land was removed again (the reviewed bucket is empty for
    // this report).
    const { data: revs } = await client
      .from("publication_revisions")
      .select("id")
      .eq("report_id", reportId);
    expect(revs ?? []).toHaveLength(0);
    const { data: reviewed } = await client.storage.from("demo-reviewed").list(reportId);
    expect(reviewed ?? []).toHaveLength(0);
    expect((await getOwnReport(owner, reportId)).community_visibility).toBe("private");

    // The failed attempt released its idempotency receipt, so the SAME key
    // retries for real and freezes both images.
    const req = await requestPublication(owner, reportId, body, key);
    expect(req.state).toBe("pending_review");
    const detail = await getReviewDetail(req.publication_revision_id);
    expect(detail.asset_ids).toHaveLength(2);
    const { data: reviewedAfter } = await client.storage.from("demo-reviewed").list(reportId);
    expect(reviewedAfter ?? []).toHaveLength(2);
  });

  it("the transaction itself refuses frozen assets that are not this report's evidence", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const { reportId, version } = await readyReport(owner);
    const theirs = await readyReport(stranger);

    // Bypass the service layer entirely: hand the function a foreign evidence id
    // with a plausible path, as a buggy or malicious caller would.
    const { data, error } = await client.rpc("fp_request_publication", {
      p_report_id: reportId,
      p_actor: owner,
      p_source_update_id: null,
      p_expected_version: version,
      p_payload: { report_id: reportId, product_name: "x", brand: "y" },
      p_assets: [
        { source_evidence_id: theirs.evidenceId, object_path: `demo-reviewed/${reportId}/forged.png` },
      ],
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("FP422");
    expect(error?.message).toMatch(/does not belong to this report/);

    const { data: revs } = await client
      .from("publication_revisions")
      .select("id")
      .eq("report_id", reportId);
    expect(revs ?? []).toHaveLength(0);

    // And a wrong owner is NOT_FOUND, exactly as the service reports it.
    const foreign = await client.rpc("fp_request_publication", {
      p_report_id: reportId,
      p_actor: stranger,
      p_source_update_id: null,
      p_expected_version: version,
      p_payload: { report_id: reportId },
      p_assets: [],
    });
    expect(foreign.error?.code).toBe("FP404");
  });

  it("re-approving a corrected response projects only the latest revision and stops serving the superseded image", async () => {
    const owner = await newUser();
    const reviewer = await newReviewer();
    const viewer = await newUser();
    const { reportId, evidenceId, version } = await readyReport(owner);

    const concern = await requestPublication(
      owner,
      reportId,
      { expected_version: version, consent: true, selected_evidence_ids: [evidenceId] },
      randomUUID(),
    );
    await decideReview(reviewer, concern.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    const submission = await recordSubmission(
      owner,
      reportId,
      { channel: "brand", recipient: "Sample Pantry care", submitted_at: "2026-09-01" },
      randomUUID(),
    );
    const response = await recordUpdate(
      owner,
      reportId,
      { submission_id: submission.id, kind: "response", sender: "Sample Pantry", occurred_at: "2026-09-02", summary: "First wording of the reply." },
      randomUUID(),
    );

    // First response revision, with the label image attached, approved.
    let v = (await getOwnReport(owner, reportId)).version;
    const first = await requestPublication(
      owner,
      reportId,
      { expected_version: v, consent: true, selected_evidence_ids: [evidenceId], source_update_id: response.id },
      randomUUID(),
    );
    const firstAssets = (await getReviewDetail(first.publication_revision_id)).asset_ids;
    expect(firstAssets).toHaveLength(1);
    await decideReview(reviewer, first.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    // The reporter re-requests the SAME response (e.g. after a correction) with
    // a different image; the reviewer approves again.
    const replacement = await addEvidence(
      owner,
      reportId,
      { kind: "response", roles: [] },
      { bytes: samplePng() },
      randomUUID(),
    );
    v = (await getOwnReport(owner, reportId)).version;
    const second = await requestPublication(
      owner,
      reportId,
      { expected_version: v, consent: true, selected_evidence_ids: [replacement.id], source_update_id: response.id },
      randomUUID(),
    );
    const secondAssets = (await getReviewDetail(second.publication_revision_id)).asset_ids;
    expect(secondAssets).toHaveLength(1);
    await decideReview(reviewer, second.publication_revision_id, { expected_version: 0, action: "approve" }, randomUUID());

    // Both rows are `approved` in the database…
    const { data: approved } = await client
      .from("publication_revisions")
      .select("id")
      .eq("source_update_id", response.id)
      .eq("state", "approved");
    expect(approved ?? []).toHaveLength(2);

    // …but the public projection carries the response exactly once, as the
    // latest revision, and only that revision's image still serves.
    const pub = await getPublicReport(reportId);
    const forThisUpdate = pub.responses.filter((r) => r.summary === "First wording of the reply.");
    expect(forThisUpdate).toHaveLength(1);
    expect(forThisUpdate[0]?.publication_revision_id).toBe(second.publication_revision_id);

    const served = await readPublicationAssetForMedia({ accessId: viewer, role: "user" }, secondAssets[0]!);
    expect(served.mimeType).toBe("image/png");
    const gone = await expectApiError(
      readPublicationAssetForMedia({ accessId: viewer, role: "user" }, firstAssets[0]!),
    );
    expect(gone.code).toBe("NOT_FOUND");
  });
});
