import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import type { ReportWriteRequest } from "@/lib/contracts";
import { createReport, confirmFacts } from "@/lib/server/reports";
import { addEvidence } from "@/lib/server/evidence";
import {
  cleanupStorage,
  createAccess,
  deleteAccess,
  liveSuite,
  testClient,
} from "../helpers/live";
import { readableLabelPng } from "../helpers/text-image";

/**
 * Pilot integrity hardening exercised on the trusted boundary
 * (supabase/migrations/0005_pilot_integrity_hardening.sql). Needs schema 5 and
 * reports BLOCKED until 0005 is applied to the demo project.
 *
 *  - #1 Publication evidence coverage: fp_request_publication is called
 *    DIRECTLY, so a caller bypassing the share screen still cannot freeze a
 *    concern whose selected assets miss a required role.
 *  - #2 Abandoned AI reservations: fp_sweep_abandoned_ai_reservations releases
 *    only reservations far older than any live request, never a recent one.
 *  - #4 Analytics limiter: record_analytics_event_attempt increments atomically
 *    per tumbling window.
 */
const suite = await liveSuite("pilot integrity hardening (live Supabase)", {
  requiresSchema: 5,
});

suite.run(suite.title, () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdReports: string[] = [];
  const createdSubjects: string[] = [];

  afterAll(async () => {
    if (createdSubjects.length) {
      await client
        .from("analytics_event_attempts")
        .delete()
        .in("subject", createdSubjects);
    }
    // Directly-inserted ledger rows are keyed by access and cascade with it.
    await cleanupStorage(client, createdReports);
    await deleteAccess(client, createdAccess);
  });

  async function tester() {
    const a = await createAccess(client, { role: "user", label: "hardening@foodproof" });
    createdAccess.push(a.accessId);
    return a.accessId;
  }

  const baseReport = (): ReportWriteRequest => ({
    product_name: "Oat Crackers",
    brand: "Sample Pantry",
    variant: null,
    concern_text: "The pack says gluten-free but the ingredients list oat flour.",
    claim_text: null,
    ingredients_text: null,
    expected_version: null,
  });

  /** A ready report with the given label images, each carrying the given roles. */
  async function readyReport(
    owner: string,
    images: { roles: ("identity" | "claim" | "ingredients")[] }[],
  ): Promise<{ reportId: string; version: number }> {
    const report = await createReport(owner, baseReport(), randomUUID());
    createdReports.push(report.report_id);
    for (const img of images) {
      await addEvidence(
        owner,
        report.report_id,
        { kind: "label", roles: img.roles },
        { bytes: readableLabelPng() },
        randomUUID(),
      );
    }
    const confirmed = await confirmFacts(
      owner,
      report.report_id,
      {
        expected_version: report.version + images.length,
        claim_text: "Gluten free",
        ingredients_text: "Oat flour, sugar, salt",
        method: "manual",
      },
      randomUUID(),
    );
    return { reportId: report.report_id, version: confirmed.version };
  }

  /** The report's own ready label evidence: id, object_path and roles. */
  async function evidenceOf(reportId: string) {
    const { data, error } = await client
      .from("evidence")
      .select("id, object_path, roles")
      .eq("report_id", reportId)
      .eq("kind", "label");
    if (error) throw error;
    return (data ?? []) as { id: string; object_path: string; roles: string[] }[];
  }

  async function requestPubRpc(
    owner: string,
    reportId: string,
    version: number,
    assets: { id: string; object_path: string }[],
  ) {
    return client.rpc("fp_request_publication", {
      p_report_id: reportId,
      p_actor: owner,
      p_source_update_id: null,
      p_expected_version: version,
      p_payload: { report_id: reportId, product_name: "Oat Crackers", brand: "Sample Pantry" },
      p_assets: assets.map((a) => ({ source_evidence_id: a.id, object_path: a.object_path })),
    });
  }

  // -------------------------------------------------------------------------
  // #1 Publication evidence coverage — the database is the final authority.
  // -------------------------------------------------------------------------

  it("rejects a concern whose selected assets miss a required role", async () => {
    const owner = await tester();
    const { reportId, version } = await readyReport(owner, [
      { roles: ["identity"] },
      { roles: ["claim"] },
      { roles: ["ingredients"] },
    ]);
    const ev = await evidenceOf(reportId);
    const byRole = (role: string) => ev.find((e) => e.roles.includes(role))!;
    const identity = byRole("identity");
    const claim = byRole("claim");
    const ingredients = byRole("ingredients");

    // Missing ingredients in the selection, even though the report HAS it.
    const missing = await requestPubRpc(owner, reportId, version, [identity, claim]);
    expect(missing.error).not.toBeNull();
    expect(missing.error!.code).toBe("FP422");

    // A single-role selection is also rejected.
    const single = await requestPubRpc(owner, reportId, version, [identity]);
    expect(single.error!.code).toBe("FP422");

    // An asset from another report is rejected before coverage is even reached.
    const other = await tester();
    const otherReport = await readyReport(other, [
      { roles: ["identity", "claim", "ingredients"] },
    ]);
    const foreign = (await evidenceOf(otherReport.reportId))[0]!;
    const foreignCall = await requestPubRpc(owner, reportId, version, [foreign]);
    expect(foreignCall.error!.code).toBe("FP422");

    // The full selection succeeds and creates exactly one pending revision.
    const full = await requestPubRpc(owner, reportId, version, [identity, claim, ingredients]);
    expect(full.error).toBeNull();
    expect((full.data as { content_kind: string }).content_kind).toBe("concern");
  });

  it("accepts one image that carries all three roles", async () => {
    const owner = await tester();
    const { reportId, version } = await readyReport(owner, [
      { roles: ["identity", "claim", "ingredients"] },
    ]);
    const ev = await evidenceOf(reportId);
    const ok = await requestPubRpc(owner, reportId, version, [ev[0]!]);
    expect(ok.error).toBeNull();
    expect((ok.data as { publication_revision_id: string }).publication_revision_id).toBeTruthy();
  });

  it("lets only one of two concurrent full-coverage requests win", async () => {
    const owner = await tester();
    const { reportId, version } = await readyReport(owner, [
      { roles: ["identity", "claim", "ingredients"] },
    ]);
    const ev = await evidenceOf(reportId);
    const [a, b] = await Promise.all([
      requestPubRpc(owner, reportId, version, [ev[0]!]),
      requestPubRpc(owner, reportId, version, [ev[0]!]),
    ]);
    const results = [a, b];
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const denied = results.filter((r) => r.error);
    expect(denied).toHaveLength(1);
    // Either the stale-version guard or the pending guard — both are FP409.
    expect(denied[0]!.error!.code).toBe("FP409");
  });

  // -------------------------------------------------------------------------
  // #2 Abandoned AI reservations.
  // -------------------------------------------------------------------------

  it("sweeps only reservations far older than any live request", async () => {
    const owner = await tester();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: oldRow, error: oldErr } = await client
      .from("ai_spend_ledger")
      .insert({
        access_id: owner,
        operation: "extract",
        model: "test-model",
        state: "reserved",
        reserved_micros: 1_000,
        created_at: twoHoursAgo,
      })
      .select("id")
      .single();
    if (oldErr) throw oldErr;

    const { data: freshRow, error: freshErr } = await client
      .from("ai_spend_ledger")
      .insert({
        access_id: owner,
        operation: "extract",
        model: "test-model",
        state: "reserved",
        reserved_micros: 1_000,
      })
      .select("id")
      .single();
    if (freshErr) throw freshErr;

    // The floor raises a too-small threshold to 3600s, so the fresh row is safe.
    const swept = await client.rpc("fp_sweep_abandoned_ai_reservations", {
      p_older_than_seconds: 10,
    });
    expect(swept.error).toBeNull();
    expect((swept.data as { threshold_seconds: number }).threshold_seconds).toBe(3600);

    const { data: after } = await client
      .from("ai_spend_ledger")
      .select("id, state")
      .in("id", [oldRow!.id, freshRow!.id]);
    const stateById = new Map((after ?? []).map((r) => [r.id, r.state]));
    expect(stateById.get(oldRow!.id)).toBe("released");
    expect(stateById.get(freshRow!.id)).toBe("reserved");
  });

  // -------------------------------------------------------------------------
  // #4 Analytics limiter increment.
  // -------------------------------------------------------------------------

  it("increments the analytics attempt counter atomically per window", async () => {
    const subject = randomUUID();
    createdSubjects.push(subject);
    const window = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    const expires = new Date(Date.parse(window) + 60000).toISOString();

    const counts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { data, error } = await client.rpc("record_analytics_event_attempt", {
        p_subject: subject,
        p_window: window,
        p_expires: expires,
      });
      if (error) throw error;
      counts.push(Number(data));
    }
    expect(counts).toEqual([1, 2, 3]);

    // A new window resets the count for the same subject.
    const nextWindow = new Date(Date.parse(window) + 60000).toISOString();
    const { data: reset, error: resetErr } = await client.rpc("record_analytics_event_attempt", {
      p_subject: subject,
      p_window: nextWindow,
      p_expires: new Date(Date.parse(nextWindow) + 60000).toISOString(),
    });
    if (resetErr) throw resetErr;
    expect(Number(reset)).toBe(1);
  });
});
