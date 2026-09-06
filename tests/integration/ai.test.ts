import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReportWriteRequest } from "@/lib/contracts";
import { ApiError } from "@/lib/server/errors";
import { createReport, confirmFacts } from "@/lib/server/reports";
import { addEvidence } from "@/lib/server/evidence";
import { prepareDraft, saveComplaintDraft, SAMPLE_NOTICE } from "@/lib/server/drafts";
import { getOwnReport } from "@/lib/server/data";
import type { MeteredAiAdapter } from "@/lib/server/ai";
import { AI_LIMITS, type AiLimits } from "@/lib/server/ai/limits";
import { draftForReport, extractForReport } from "@/lib/server/ai/assist";
import {
  cleanupStorage,
  createAccess,
  deleteAccess,
  liveSuite,
  samplePng,
  testClient,
} from "../helpers/live";
import { injectionLabelPng, readableLabelPng } from "../helpers/text-image";

/**
 * Assisted extraction and drafting against the live demo Supabase project and,
 * where a provider key is configured, the live provider
 * (FOODPROOF_API_DETAILS.md "AI endpoints", FOODPROOF_TECHNICAL_SPEC.md §8).
 *
 * The ledger and validation groups need migration 0004 and report BLOCKED
 * without it. The provider group additionally needs AI_PROVIDER /
 * AI_PROVIDER_API_KEY and is SKIPPED with a stated reason when they are absent —
 * a skip is never evidence that a live call succeeded, and `method: "assisted"`
 * is never produced from a fixture.
 *
 * Every fixture is fictional synthetic evidence.
 */
const aiSuite = await liveSuite("AI assistance (live Supabase)", { requiresSchema: 4 });

const providerConfigured =
  process.env.AI_PROVIDER === "anthropic" && Boolean(process.env.AI_PROVIDER_API_KEY);

const PDF_BYTES = Uint8Array.from(
  Array.from("%PDF-1.4\n%fictional receipt\n", (c) => c.charCodeAt(0)),
);

aiSuite.run(aiSuite.title, () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdReports: string[] = [];

  afterAll(async () => {
    await cleanupStorage(client, createdReports);
    await deleteAccess(client, createdAccess);
  });

  async function tester() {
    const a = await createAccess(client, { role: "user", label: "ai@foodproof" });
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

  async function reportWithLabel(
    accessId: string,
    bytes: Uint8Array,
  ): Promise<{ reportId: string; evidenceId: string }> {
    const report = await createReport(accessId, baseReport(), randomUUID());
    createdReports.push(report.report_id);
    const evidence = await addEvidence(
      accessId,
      report.report_id,
      { kind: "label", roles: ["identity", "claim", "ingredients"] },
      { bytes },
      randomUUID(),
    );
    return { reportId: report.report_id, evidenceId: evidence.id };
  }

  /** An adapter that fails the test if the provider is reached at all. */
  const forbiddenAdapter: MeteredAiAdapter = {
    model: "must-not-be-called",
    async extractLabelMetered() {
      throw new Error("the provider must not be called");
    },
    async draftComplaintMetered() {
      throw new Error("the provider must not be called");
    },
    async extractLabel() {
      throw new Error("the provider must not be called");
    },
    async draftComplaint() {
      throw new Error("the provider must not be called");
    },
  };

  async function ledgerRows(accessId: string) {
    const { data, error } = await client
      .from("ai_spend_ledger")
      .select("*")
      .eq("access_id", accessId)
      .order("created_at");
    if (error) throw error;
    return data ?? [];
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

  // -------------------------------------------------------------------------
  // Ownership and evidence: refused before any reservation exists.
  // -------------------------------------------------------------------------

  it("refuses another reporter's evidence without revealing that it exists", async () => {
    const owner = await tester();
    const other = await tester();
    const mine = await reportWithLabel(owner, readableLabelPng());
    const theirs = await reportWithLabel(other, readableLabelPng());

    const err = await expectApiError(
      extractForReport(
        owner,
        mine.reportId,
        { evidence_ids: [theirs.evidenceId] },
        { adapter: forbiddenAdapter },
      ),
    );
    expect(["NOT_FOUND", "VALIDATION_FAILED"]).toContain(err.code);
    expect(err.message).not.toContain(theirs.evidenceId);
    expect(await ledgerRows(owner)).toHaveLength(0);

    // And the other reporter's report is invisible even by id.
    const hidden = await expectApiError(
      extractForReport(
        owner,
        theirs.reportId,
        { evidence_ids: [theirs.evidenceId] },
        { adapter: forbiddenAdapter },
      ),
    );
    expect(hidden.code).toBe("NOT_FOUND");
    expect(await ledgerRows(owner)).toHaveLength(0);
  });

  it("refuses a missing evidence id, a receipt PDF and an oversized image, with no ledger row", async () => {
    const owner = await tester();
    const { reportId, evidenceId } = await reportWithLabel(owner, readableLabelPng());

    const missing = await expectApiError(
      extractForReport(
        owner,
        reportId,
        { evidence_ids: [randomUUID()] },
        { adapter: forbiddenAdapter },
      ),
    );
    expect(missing.code).toBe("VALIDATION_FAILED");

    const receipt = await addEvidence(
      owner,
      reportId,
      { kind: "receipt", roles: [] },
      { bytes: PDF_BYTES },
      randomUUID(),
    );
    expect(receipt.mime_type).toBe("application/pdf");
    const pdf = await expectApiError(
      extractForReport(
        owner,
        reportId,
        { evidence_ids: [receipt.id] },
        { adapter: forbiddenAdapter },
      ),
    );
    expect(pdf.code).toBe("VALIDATION_FAILED");

    const tinyLimits: AiLimits = { ...AI_LIMITS, maxImageBytes: 10 };
    const oversized = await expectApiError(
      extractForReport(
        owner,
        reportId,
        { evidence_ids: [evidenceId] },
        { adapter: forbiddenAdapter, limits: tinyLimits },
      ),
    );
    expect(oversized.code).toBe("VALIDATION_FAILED");

    expect(await ledgerRows(owner)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // The durable spend ledger. Caps are injected so exhaustion is provable
  // without spending the pilot's real budget.
  // -------------------------------------------------------------------------

  it.each([
    ["per-call", { perCallCapMicros: 1 }],
    ["per-invitation", { perInvitationCapMicros: 1 }],
    ["pilot-wide", { totalCapMicros: 1 }],
  ])(
    "refuses a call that would breach the %s cap, before reaching the provider",
    async (_name, capOverride) => {
      const owner = await tester();
      const { reportId, evidenceId } = await reportWithLabel(owner, readableLabelPng());
      const limits: AiLimits = { ...AI_LIMITS, ...capOverride };

      const err = await expectApiError(
        extractForReport(
          owner,
          reportId,
          { evidence_ids: [evidenceId] },
          { adapter: forbiddenAdapter, limits },
        ),
      );
      expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(await ledgerRows(owner)).toHaveLength(0);
    },
  );

  it("enforces the frequency limit with a Retry-After hint", async () => {
    const owner = await tester();
    const { reportId, evidenceId } = await reportWithLabel(owner, readableLabelPng());
    const limits: AiLimits = { ...AI_LIMITS, rateLimitCalls: 1 };

    const succeeding: MeteredAiAdapter = {
      ...forbiddenAdapter,
      model: "test-model",
      async extractLabelMetered() {
        return {
          result: { brand: "Sample Pantry", unreadableFields: [] },
          usage: { inputTokens: 1_000, outputTokens: 100 },
        };
      },
    };

    await extractForReport(
      owner,
      reportId,
      { evidence_ids: [evidenceId] },
      { adapter: succeeding, limits },
    );
    const err = await expectApiError(
      extractForReport(
        owner,
        reportId,
        { evidence_ids: [evidenceId] },
        { adapter: forbiddenAdapter, limits },
      ),
    );
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.retryAfterSeconds).toBeGreaterThan(0);

    const rows = await ledgerRows(owner);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("settled");
  });

  it("releases a failed call so an immediate retry is not charged twice", async () => {
    const owner = await tester();
    const { reportId, evidenceId } = await reportWithLabel(owner, readableLabelPng());

    let attempts = 0;
    const flaky: MeteredAiAdapter = {
      ...forbiddenAdapter,
      model: "test-model",
      async extractLabelMetered() {
        attempts += 1;
        if (attempts === 1) throw new Error("provider unreachable");
        return {
          result: { brand: "Sample Pantry", unreadableFields: [] },
          usage: { inputTokens: 1_000, outputTokens: 100 },
        };
      },
    };

    const failure = await expectApiError(
      extractForReport(owner, reportId, { evidence_ids: [evidenceId] }, { adapter: flaky }),
    );
    expect(failure.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(failure.message).toBe("AI assistance is unavailable.");

    const retry = await extractForReport(
      owner,
      reportId,
      { evidence_ids: [evidenceId] },
      { adapter: flaky },
    );
    expect(retry.method).toBe("assisted");

    const rows = await ledgerRows(owner);
    expect(rows.map((r) => r.state)).toEqual(["released", "settled"]);
    expect(rows.filter((r) => r.state === "settled")).toHaveLength(1);

    const settled = rows.find((r) => r.state === "settled")!;
    expect(settled.input_tokens).toBe(1_000);
    expect(settled.output_tokens).toBe(100);
    expect(settled.model).toBe("test-model");
    expect(Number(settled.settled_micros)).toBe(1_000 * 2 + 100 * 10);
    // The ledger holds money, tokens and a model id — there is no column that
    // could hold a prompt, an image, an extracted field or a draft.
    expect(Object.keys(settled).sort()).toEqual([
      "access_id",
      "channel",
      "created_at",
      "id",
      "input_tokens",
      "model",
      "operation",
      "output_tokens",
      "report_id",
      "reserved_micros",
      "settled_at",
      "settled_micros",
      "state",
    ]);
  });

  // -------------------------------------------------------------------------
  // Assisted-method gating.
  // -------------------------------------------------------------------------

  it("refuses to record an assisted confirmation or draft that never happened", async () => {
    const owner = await tester();
    const { reportId } = await reportWithLabel(owner, readableLabelPng());
    const detail = await getOwnReport(owner, reportId);

    const confirmErr = await expectApiError(
      confirmFacts(
        owner,
        reportId,
        {
          expected_version: detail.version,
          claim_text: "Gluten-free",
          ingredients_text: "Oat flour, sunflower oil, salt",
          method: "assisted",
        },
        randomUUID(),
      ),
    );
    expect(confirmErr.code).toBe("VALIDATION_FAILED");
    expect(confirmErr.message).toBe("No assisted extraction exists for this report.");

    const draftErr = await expectApiError(
      saveComplaintDraft(
        owner,
        reportId,
        "brand",
        {
          subject: "Labelling concern",
          body: "Sample body.",
          method: "assisted",
          expected_version: null,
        },
        randomUUID(),
      ),
    );
    expect(draftErr.code).toBe("VALIDATION_FAILED");
    expect(draftErr.message).toBe("No assisted draft exists for this channel.");
  });

  it("keeps the manual and template paths working with the AI provider switched off", async () => {
    const owner = await tester();
    const { reportId } = await reportWithLabel(owner, readableLabelPng());

    const savedProvider = process.env.AI_PROVIDER;
    const savedKey = process.env.AI_PROVIDER_API_KEY;
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER_API_KEY;
    vi.resetModules();
    try {
      const { getAiAdapter } = await import("@/lib/server/ai");
      expect(getAiAdapter()).toBeNull();

      const reports = await import("@/lib/server/reports");
      const drafts = await import("@/lib/server/drafts");
      const data = await import("@/lib/server/data");

      const before = await data.getOwnReport(owner, reportId);
      const confirmed = await reports.confirmFacts(
        owner,
        reportId,
        {
          expected_version: before.version,
          claim_text: "Gluten-free",
          ingredients_text: "Oat flour, sunflower oil, salt",
          method: "manual",
        },
        randomUUID(),
      );
      expect(confirmed.facts_confirmed_at).not.toBeNull();

      const template = await drafts.prepareDraft(owner, reportId, "brand");
      expect(template.method).toBe("template");
      expect(template.body).toContain("SAMPLE / DEMONSTRATION CONTENT");

      const saved = await drafts.saveComplaintDraft(
        owner,
        reportId,
        "brand",
        {
          subject: template.subject,
          body: template.body,
          method: "template",
          expected_version: null,
        },
        randomUUID(),
      );
      expect(saved.method).toBe("template");
    } finally {
      if (savedProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = savedProvider;
      if (savedKey === undefined) delete process.env.AI_PROVIDER_API_KEY;
      else process.env.AI_PROVIDER_API_KEY = savedKey;
      vi.resetModules();
    }

    // No AI was involved, so nothing was ever metered.
    expect(await ledgerRows(owner)).toHaveLength(0);
    // And the statically imported prepareDraft keeps working too.
    const again = await prepareDraft(owner, reportId, "government");
    expect(again.method).toBe("template");
    expect(again.body).toContain(SAMPLE_NOTICE);
  });

  // -------------------------------------------------------------------------
  // The live provider. Real calls, real money, kept to five.
  // -------------------------------------------------------------------------

  const providerDescribe = providerConfigured ? describe : describe.skip;
  providerDescribe(
    providerConfigured
      ? "live provider"
      : "live provider — SKIPPED: AI_PROVIDER / AI_PROVIDER_API_KEY not set",
    () => {
      let owner = "";
      let reportId = "";
      let evidenceId = "";

      beforeAll(async () => {
        owner = await tester();
        const created = await reportWithLabel(owner, readableLabelPng());
        reportId = created.reportId;
        evidenceId = created.evidenceId;
      });

      it("reads a readable synthetic label and reports it as assisted", async () => {
        const response = await extractForReport(owner, reportId, {
          evidence_ids: [evidenceId],
        });
        // The fixture is fictional, so echoing what the provider read is safe
        // and is the evidence that this suite really called a live provider.
        console.log("[ai test] readable label:", JSON.stringify(response.suggestions));
        expect(response.method).toBe("assisted");
        expect(response.evidence_ids).toEqual([evidenceId]);
        expect(response.suggestions.brand?.toUpperCase()).toContain("SAMPLE PANTRY");
        expect(response.suggestions.claim_text?.toUpperCase()).toContain("GLUTEN-FREE");
        expect(response.unreadable_fields).not.toContain("brand");

        const rows = await ledgerRows(owner);
        const settled = rows.filter((r) => r.state === "settled");
        expect(settled).toHaveLength(1);
        expect(settled[0]!.input_tokens).toBeGreaterThan(0);
        expect(settled[0]!.output_tokens).toBeGreaterThan(0);
        expect(settled[0]!.model).toBe(process.env.AI_MODEL ?? "claude-sonnet-5");
      });

      it("accepts an assisted confirmation once a real extraction has been paid for", async () => {
        const before = await getOwnReport(owner, reportId);
        const confirmed = await confirmFacts(
          owner,
          reportId,
          {
            expected_version: before.version,
            claim_text: "Gluten-free",
            ingredients_text: "Oat flour, sunflower oil, salt",
            method: "assisted",
          },
          randomUUID(),
        );
        expect(confirmed.facts_confirmed_at).not.toBeNull();
      });

      it("drafts from the confirmed facts without verdicts, citations or invented values", async () => {
        const draft = await draftForReport(owner, reportId, "brand");
        console.log("[ai test] draft subject:", JSON.stringify(draft.subject));
        console.log("[ai test] draft body:\n", draft.body);
        expect(draft.method).toBe("assisted");
        expect(draft.channel).toBe("brand");
        expect(draft.subject.trim().length).toBeGreaterThan(0);

        expect(draft.body).toContain(SAMPLE_NOTICE);
        expect(draft.body.startsWith(SAMPLE_NOTICE)).toBe(true);
        expect(draft.body.trimEnd().endsWith(SAMPLE_NOTICE)).toBe(true);
        expect(draft.body.toLowerCase()).toContain("sample pantry");
        expect(draft.body.toLowerCase()).toContain("oat crackers");

        // Word-boundary checks: "food safety" is allowed, a verdict is not.
        expect(draft.body).not.toMatch(/\bunsafe\b/i);
        expect(draft.body).not.toMatch(/\bfiled\b/i);
        expect(draft.body).not.toMatch(/\bSection\s+\d/);
        const outsideNotice = draft.body.split(SAMPLE_NOTICE).join(" ");
        expect(outsideNotice).not.toMatch(/\bsafe\b/i);

        // The report has no batch number, so any mention must be a placeholder.
        const withoutPlaceholders = draft.body.replace(/\[[^\]]*\]/g, " ");
        expect(withoutPlaceholders).not.toMatch(/\bbatch\b/i);
      });

      it("accepts an assisted draft save for that channel only", async () => {
        // Uses the settled `draft` ledger row from the previous test; no extra
        // provider call is made here.
        const saved = await saveComplaintDraft(
          owner,
          reportId,
          "brand",
          {
            subject: "Labelling concern about Sample Pantry Oat Crackers",
            body: `${SAMPLE_NOTICE}\n\nPlease clarify the labelling.\n\n${SAMPLE_NOTICE}`,
            method: "assisted",
            expected_version: null,
          },
          randomUUID(),
        );
        expect(saved.method).toBe("assisted");

        const wrongChannel = await expectApiError(
          saveComplaintDraft(
            owner,
            reportId,
            "government",
            {
              subject: "Consumer grievance",
              body: "Sample body.",
              method: "assisted",
              expected_version: null,
            },
            randomUUID(),
          ),
        );
        expect(wrongChannel.code).toBe("VALIDATION_FAILED");
        expect(wrongChannel.message).toBe("No assisted draft exists for this channel.");
      });

      it("reports every field as unreadable for an image with nothing on it", async () => {
        const reader = await tester();
        const blank = await reportWithLabel(reader, samplePng());
        const response = await extractForReport(reader, blank.reportId, {
          evidence_ids: [blank.evidenceId],
        });
        expect(response.method).toBe("assisted");
        expect(response.suggestions).toEqual({
          product_name: null,
          brand: null,
          claim_text: null,
          ingredients_text: null,
        });
        expect(response.unreadable_fields.sort()).toEqual([
          "brand",
          "claim_text",
          "ingredients_text",
          "product_name",
        ]);
      });

      it("treats instruction-like text printed on a label as evidence, not as instructions", async () => {
        const reader = await tester();
        const injected = await reportWithLabel(reader, injectionLabelPng());
        const response = await extractForReport(reader, injected.reportId, {
          evidence_ids: [injected.evidenceId],
        });
        console.log("[ai test] injection label:", JSON.stringify(response.suggestions));
        expect(response.method).toBe("assisted");
        expect(response.suggestions.brand?.toUpperCase() ?? "").not.toContain(
          "ADMIN OVERRIDE",
        );
        for (const value of Object.values(response.suggestions)) {
          if (!value) continue;
          expect(value).not.toMatch(/\bsafe\b/i);
          expect(value).not.toMatch(/\bfiled\b/i);
        }
      });

      it("reads the real fictional label photograph", async () => {
        const reader = await tester();
        const photo = await reportWithLabel(
          reader,
          new Uint8Array(readFileSync("public/illustrative-label.jpg")),
        );
        const response = await extractForReport(reader, photo.reportId, {
          evidence_ids: [photo.evidenceId],
        });
        console.log(
          "[ai test] photograph:",
          JSON.stringify(response.suggestions),
          JSON.stringify(response.unreadable_fields),
        );
        expect(response.method).toBe("assisted");
        const readFields = Object.entries(response.suggestions).filter(([, v]) => v);
        // Either it read something, or it honestly said which fields it could not.
        expect(readFields.length + response.unreadable_fields.length).toBeGreaterThan(0);
        for (const [, value] of readFields) {
          expect(String(value)).not.toMatch(/\bsafe\b/i);
        }

        const rows = await ledgerRows(reader);
        expect(rows.filter((r) => r.state === "settled")).toHaveLength(1);
      });

      it("keeps the whole live-provider run far below the per-call budget", async () => {
        const { data, error } = await client.rpc("fp_ai_spend_totals");
        expect(error).toBeNull();
        const totals = data as {
          settled: number;
          released: number;
          reserved_open: number;
          effective_micros: number;
        };
        expect(totals.settled).toBeGreaterThan(0);
        expect(totals.reserved_open).toBe(0);

        const { data: rows, error: rowErr } = await client
          .from("ai_spend_ledger")
          .select("settled_micros, state, model")
          .in("access_id", createdAccess)
          .eq("state", "settled");
        if (rowErr) throw rowErr;
        const spent = (rows ?? []).reduce(
          (sum, r) => sum + Number(r.settled_micros ?? 0),
          0,
        );
        console.log(`[ai test] settled micro-USD for this run: ${spent}`);
        expect(spent).toBeLessThan(50_000);
      });
    },
  );
});
