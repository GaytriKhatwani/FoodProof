import { afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { ReportWriteRequest } from "@/lib/contracts";
import { ApiError } from "@/lib/server/errors";
import { createReport, confirmFacts } from "@/lib/server/reports";
import { getOwnReport } from "@/lib/server/data";
import {
  addEvidence,
  readEvidenceForMedia,
  removeEvidence,
} from "@/lib/server/evidence";
import { ORIGINALS_BUCKET, REVIEWED_BUCKET } from "@/lib/server/storage";
import { createAccess, deleteAccess, liveDescribe, testClient } from "../helpers/live";

/**
 * Evidence upload, guarded media access, content sniffing, and readiness
 * recomputation (FOODPROOF_TECHNICAL_SPEC.md §4/§5, FOODPROOF_API_DETAILS.md).
 */
liveDescribe("evidence + storage (live Supabase)", () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdReports: string[] = [];

  afterAll(async () => {
    // Remove any storage objects under the created report prefixes.
    for (const bucket of [ORIGINALS_BUCKET, REVIEWED_BUCKET]) {
      for (const reportId of createdReports) {
        const { data } = await client.storage.from(bucket).list(reportId);
        if (data && data.length) {
          await client.storage
            .from(bucket)
            .remove(data.map((o) => `${reportId}/${o.name}`));
        }
      }
    }
    await deleteAccess(client, createdAccess);
  });

  async function tester() {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId);
    return a.accessId;
  }

  const baseReport = (): ReportWriteRequest => ({
    product_name: "Sample Pantry Crackers",
    brand: "Sample Pantry",
    variant: null,
    concern_text: "Label claims gluten-free but lists wheat.",
    claim_text: null,
    ingredients_text: null,
    expected_version: null,
  });

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  function pngBytes(): Uint8Array {
    const chunk = (type: string, data: number[]) => {
      const len = data.length;
      const b = [(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff];
      for (const c of type) b.push(c.charCodeAt(0));
      b.push(...data, 0, 0, 0, 0);
      return b;
    };
    return Uint8Array.from([
      ...PNG_SIG,
      ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
      ...chunk("IDAT", [0x78, 0x9c, 0x62, 0, 0, 0, 2, 0, 1]),
      ...chunk("IEND", []),
    ]);
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

  it("uploads a sniffed label image and serves it only to the owner", async () => {
    const owner = await tester();
    const other = await tester();
    const report = await createReport(owner, baseReport(), randomUUID());
    createdReports.push(report.report_id);

    const ev = await addEvidence(
      owner,
      report.report_id,
      { kind: "label", roles: ["identity"] },
      { bytes: pngBytes() },
      randomUUID(),
    );
    expect(ev.mime_type).toBe("image/png");
    expect(ev.upload_state).toBe("ready");
    expect(ev.roles).toEqual(["identity"]);

    // Owner can read the bytes through the guarded path.
    const media = await readEvidenceForMedia({ accessId: owner, role: "user" }, ev.id);
    expect(media.mimeType).toBe("image/png");
    expect(media.bytes.length).toBeGreaterThan(0);

    // Another tester cannot (NOT_FOUND, existence hidden).
    const err = await expectApiError(
      readEvidenceForMedia({ accessId: other, role: "user" }, ev.id),
    );
    expect(err.code).toBe("NOT_FOUND");

    // A reviewer cannot read it while there is no pending review case.
    const revErr = await expectApiError(
      readEvidenceForMedia({ accessId: other, role: "reviewer" }, ev.id),
    );
    expect(revErr.code).toBe("NOT_FOUND");
  });

  it("rejects a file whose bytes are not a supported image", async () => {
    const owner = await tester();
    const report = await createReport(owner, baseReport(), randomUUID());
    createdReports.push(report.report_id);
    const garbage = Uint8Array.from([..."definitely not an image"].map((c) => c.charCodeAt(0)));
    const err = await expectApiError(
      addEvidence(owner, report.report_id, { kind: "label", roles: [] }, { bytes: garbage }, randomUUID()),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
  });

  it("recomputes readiness as evidence completes and is removed", async () => {
    const owner = await tester();
    const report = await createReport(owner, baseReport(), randomUUID());
    createdReports.push(report.report_id);

    await confirmFacts(
      owner,
      report.report_id,
      { expected_version: 0, claim_text: "Gluten-free", ingredients_text: "Wheat flour", method: "manual" },
      randomUUID(),
    );

    // A single label covering all three roles satisfies the photo requirement.
    const ev = await addEvidence(
      owner,
      report.report_id,
      { kind: "label", roles: ["identity", "claim", "ingredients"] },
      { bytes: pngBytes() },
      randomUUID(),
    );

    const ready = await getOwnReport(owner, report.report_id);
    expect(ready.preparation).toBe("ready");

    await removeEvidence(owner, ev.id, randomUUID());
    const back = await getOwnReport(owner, report.report_id);
    expect(back.preparation).toBe("draft");
    expect(back.evidence).toHaveLength(0);
  });
});
