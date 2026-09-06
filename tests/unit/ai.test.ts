import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/server/errors";
import type { MeteredAiAdapter, MeteredResult } from "@/lib/server/ai";
import {
  AI_DRAFT_SYSTEM_PROMPT,
  AI_EXTRACT_SYSTEM_PROMPT,
  AI_SYSTEM_RULES,
  AiProviderError,
  createAnthropicAdapter,
  type AiProviderClient,
} from "@/lib/server/ai/anthropic";
import {
  AI_LIMITS,
  reservationMicros,
  settlementMicros,
  type AiLimits,
} from "@/lib/server/ai/limits";
import type { AiSpendLedger, ReserveInput } from "@/lib/server/ai/spend";
import {
  draftForReport,
  extractForReport,
  withSpend,
  type AssistData,
  type AssistEvidenceRow,
  type AssistReport,
} from "@/lib/server/ai/assist";
import { textPng } from "../helpers/text-image";
import { samplePng } from "../helpers/sample-image";

/**
 * AI failure, cost and prompt behaviour with no network and no provider. These
 * assertions are about OUR handling of a provider; they are never evidence that
 * the live provider works — that is `tests/integration/ai.test.ts`.
 */

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_REPORT_ID = "22222222-2222-4222-8222-222222222222";
const EV = [
  "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  "cccccccc-3333-4333-8333-cccccccccccc",
  "dddddddd-4444-4444-8444-dddddddddddd",
];

const LABEL_BYTES = textPng(["BRAND: SAMPLE PANTRY", "CLAIM: GLUTEN-FREE"]);

const baseReport = (over?: Partial<AssistReport>): AssistReport => ({
  brand: "Sample Pantry",
  product_name: "Oat Crackers",
  variant: null,
  observation_date: "2026-08-01",
  concern_text: "The pack claims gluten-free but lists oat flour.",
  claim_text: "Gluten-free",
  ingredients_text: "Oat flour, sunflower oil, salt",
  facts_confirmed_at: "2026-08-02T00:00:00.000Z",
  ...over,
});

const evidenceRow = (
  id: string,
  over?: Partial<AssistEvidenceRow>,
): AssistEvidenceRow => ({
  id,
  report_id: REPORT_ID,
  kind: "label",
  mime_type: "image/png",
  bytes: LABEL_BYTES.length,
  upload_state: "ready",
  object_path: `demo-originals/${REPORT_ID}/${id}.png`,
  ...over,
});

function fakeData(over?: {
  report?: AssistReport;
  rows?: AssistEvidenceRow[];
  bytes?: Uint8Array;
  reportError?: Error;
}): AssistData {
  const rows = over?.rows ?? [evidenceRow(EV[0]!), evidenceRow(EV[1]!)];
  return {
    async loadReport() {
      if (over?.reportError) throw over.reportError;
      return over?.report ?? baseReport();
    },
    async loadEvidenceRows(ids) {
      return rows.filter((r) => ids.includes(r.id));
    },
    async readImageBytes() {
      return over?.bytes ?? LABEL_BYTES;
    },
  };
}

function fakeSpend() {
  const reserved: ReserveInput[] = [];
  const settled: string[] = [];
  const settledUsage: { settledMicros: number; inputTokens: number; outputTokens: number }[] = [];
  const released: string[] = [];
  const spend: AiSpendLedger = {
    async reserve(input) {
      reserved.push(input);
      return {
        ledgerId: `ledger-${reserved.length}`,
        actorSpentMicros: 0,
        totalSpentMicros: 0,
      };
    },
    async settle(ledgerId, usage) {
      settled.push(ledgerId);
      settledUsage.push(usage);
    },
    async release(ledgerId) {
      released.push(ledgerId);
    },
    async hasSettledCall() {
      return false;
    },
  };
  return { spend, reserved, settled, settledUsage, released };
}

function fakeAdapter(
  over?: Partial<Pick<MeteredAiAdapter, "extractLabelMetered" | "draftComplaintMetered">>,
): MeteredAiAdapter {
  const extract =
    over?.extractLabelMetered ??
    (async () => ({
      result: { brand: "Sample Pantry", unreadableFields: [] },
      usage: { inputTokens: 1000, outputTokens: 100 },
    }));
  const draft =
    over?.draftComplaintMetered ??
    (async () => ({
      result: { subject: "Labelling concern", body: "Please clarify the label." },
      usage: { inputTokens: 1000, outputTokens: 100 },
    }));
  return {
    model: "test-model",
    extractLabelMetered: extract,
    draftComplaintMetered: draft,
    async extractLabel(ids) {
      return (await extract(ids)).result;
    },
    async draftComplaint(facts, channel) {
      return (await draft(facts, channel)).result;
    },
  };
}

/** A provider client whose single documented binding returns canned results. */
function fakeClient(handler: (params: Record<string, unknown>) => unknown) {
  const requests: Record<string, unknown>[] = [];
  const parse = (async (params: Record<string, unknown>) => {
    requests.push(params);
    const outcome = handler(params);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }) as unknown as AiProviderClient["messages"]["parse"];
  return { client: { messages: { parse } } as AiProviderClient, requests };
}

const okExtraction = {
  stop_reason: "end_turn",
  parsed_output: {
    product_name: "Oat Crackers",
    brand: "Sample Pantry",
    claim_text: "Gluten-free",
    ingredients_text: "Oat flour, sunflower oil, salt",
    unreadable_fields: [],
  },
  usage: { input_tokens: 5000, output_tokens: 120 },
};

async function expectApiError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected an ApiError");
}

// ---------------------------------------------------------------------------

describe("AI system rules", () => {
  it("forbid obeying image text, safety verdicts and filing claims", () => {
    for (const prompt of [AI_EXTRACT_SYSTEM_PROMPT, AI_DRAFT_SYSTEM_PROMPT]) {
      expect(prompt).toContain(AI_SYSTEM_RULES);
      expect(prompt).toMatch(/not instructions/i);
      expect(prompt).toMatch(/never .*safe/i);
      expect(prompt).toMatch(/complaint was filed/i);
      expect(prompt).toMatch(/never invent/i);
      expect(prompt).toMatch(/never cite or assert law/i);
    }
  });

  it("tells extraction to null-and-list unreadable fields, and drafting to use placeholders", () => {
    expect(AI_EXTRACT_SYSTEM_PROMPT).toMatch(/unreadable_fields/);
    expect(AI_EXTRACT_SYSTEM_PROMPT).toMatch(/never guess|do not .*guess/i);
    expect(AI_DRAFT_SYSTEM_PROMPT).toMatch(/\[add batch number\]/);
    expect(AI_DRAFT_SYSTEM_PROMPT).toMatch(/SAMPLE \/ DEMONSTRATION CONTENT/);
    expect(AI_DRAFT_SYSTEM_PROMPT).toMatch(/no legal citations/i);
  });
});

describe("AI cost arithmetic", () => {
  it("keeps a full three-image extraction under the per-call cap", () => {
    const reserve = reservationMicros(AI_LIMITS, {
      imageCount: AI_LIMITS.maxEvidencePerCall,
      promptCharacters: AI_EXTRACT_SYSTEM_PROMPT.length + 300,
      maxOutputTokens: AI_LIMITS.maxOutputTokensExtract,
    });
    // 3 * 4784 image tokens + 1200 prompt tokens at $2/MTok, plus 1024 output
    // tokens at $10/MTok.
    expect(reserve).toBe(41_344);
    expect(reserve).toBeLessThan(AI_LIMITS.perCallCapMicros);
  });

  it("keeps a drafting call well under the per-call cap", () => {
    const reserve = reservationMicros(AI_LIMITS, {
      imageCount: 0,
      promptCharacters: AI_DRAFT_SYSTEM_PROMPT.length + 2_000,
      maxOutputTokens: AI_LIMITS.maxOutputTokensDraft,
    });
    expect(reserve).toBeLessThan(AI_LIMITS.perCallCapMicros);
  });

  it("settles on real usage at the published prices", () => {
    expect(settlementMicros(AI_LIMITS, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      2_000_000,
    );
    expect(settlementMicros(AI_LIMITS, { inputTokens: 0, outputTokens: 1_000_000 })).toBe(
      10_000_000,
    );
    expect(settlementMicros(AI_LIMITS, { inputTokens: 6_000, outputTokens: 400 })).toBe(
      12_000 + 4_000,
    );
  });

  it("caps the number of images and the size of one image", () => {
    expect(AI_LIMITS.maxEvidencePerCall).toBe(3);
    expect(AI_LIMITS.maxImageBytes).toBe(3 * 1024 * 1024);
    expect(AI_LIMITS.allowedImageMimeTypes).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(AI_LIMITS.totalCapMicros).toBe(2_000_000);
  });
});

describe("provider adapter", () => {
  it("sends one labelled base64 block per image and returns the suggestions", async () => {
    const { client, requests } = fakeClient(() => okExtraction);
    const adapter = createAnthropicAdapter({
      client,
      model: "test-model",
      loadImage: async () => ({ bytes: LABEL_BYTES, mimeType: "image/png" }),
    });

    const metered = await adapter.extractLabelMetered([EV[0]!, EV[1]!]);
    expect(metered.result.brand).toBe("Sample Pantry");
    expect(metered.result.unreadableFields).toEqual([]);
    expect(metered.usage).toEqual({ inputTokens: 5000, outputTokens: 120 });

    const params = requests[0]!;
    expect(params.model).toBe("test-model");
    expect(params.system).toBe(AI_EXTRACT_SYSTEM_PROMPT);
    expect(params.max_tokens).toBe(AI_LIMITS.maxOutputTokensExtract);
    expect((params.output_config as { effort: string }).effort).toBe("low");
    const content = (
      params.messages as [{ content: { type: string; text?: string }[] }]
    )[0].content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content[0]).toMatchObject({ type: "text", text: "Image 1:" });
    expect(content[2]).toMatchObject({ type: "text", text: "Image 2:" });
  });

  it.each([
    ["refusal", { ...okExtraction, stop_reason: "refusal" }],
    ["max_tokens", { ...okExtraction, stop_reason: "max_tokens" }],
    ["unparsed output", { ...okExtraction, parsed_output: null }],
    [
      "missing fields",
      { ...okExtraction, parsed_output: { brand: "Sample Pantry" } },
    ],
    [
      "wrong types",
      { ...okExtraction, parsed_output: { ...okExtraction.parsed_output, brand: 7 } },
    ],
    ["unsupported output", { ...okExtraction, parsed_output: "not an object" }],
    [
      "unknown unreadable field",
      {
        ...okExtraction,
        parsed_output: { ...okExtraction.parsed_output, unreadable_fields: ["price"] },
      },
    ],
  ])("rejects %s rather than returning a half-result", async (_name, response) => {
    const { client } = fakeClient(() => response);
    const adapter = createAnthropicAdapter({
      client,
      model: "test-model",
      loadImage: async () => ({ bytes: LABEL_BYTES, mimeType: "image/png" }),
    });
    await expect(adapter.extractLabelMetered([EV[0]!])).rejects.toBeInstanceOf(
      AiProviderError,
    );
  });

  it("rejects an empty draft", async () => {
    const { client } = fakeClient(() => ({
      stop_reason: "end_turn",
      parsed_output: { subject: "  ", body: "  " },
      usage: { input_tokens: 900, output_tokens: 10 },
    }));
    const adapter = createAnthropicAdapter({
      client,
      model: "test-model",
      loadImage: async () => ({ bytes: LABEL_BYTES, mimeType: "image/png" }),
    });
    await expect(
      adapter.draftComplaintMetered(
        {
          productName: "Oat Crackers",
          brand: "Sample Pantry",
          variant: null,
          observationDate: null,
          claimText: null,
          ingredientsText: null,
          concernText: "Concern",
        },
        "brand",
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("spend metering around a failing provider", () => {
  type ConsoleSpy = ReturnType<typeof vi.spyOn>;
  let warn: ConsoleSpy;
  let error: ConsoleSpy;
  let log: ConsoleSpy;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const reserveInput: ReserveInput = {
    accessId: "access-1",
    reportId: REPORT_ID,
    operation: "extract",
    channel: null,
    model: "test-model",
    reserveMicros: 41_344,
  };

  /** Usage the provider reports on a call it answered — and therefore billed. */
  const BILLED = { inputTokens: 5_100, outputTokens: 220 };

  // The provider never processed these: nothing was billed, so the reservation
  // is released and an immediate retry is charged once.
  const unbilled: [string, () => unknown][] = [
    [
      "rate limit",
      () => new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()),
    ],
    [
      "server error",
      () => new Anthropic.InternalServerError(503, undefined, "upstream", new Headers()),
    ],
    ["connection", () => new Anthropic.APIConnectionError({ message: "socket" })],
    ["pre-response failure", () => new AiProviderError("image_missing")],
  ];

  it.each(unbilled)(
    "turns a %s into the one generic state and releases the reservation exactly once",
    async (_name, makeError) => {
      const { spend, reserved, settled, released } = fakeSpend();
      const err = await expectApiError(
        withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
          throw makeError();
        }),
      );
      expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(err.message).toBe("AI assistance is unavailable.");
      expect(reserved).toHaveLength(1);
      expect(settled).toEqual([]);
      expect(released).toEqual(["ledger-1"]);
    },
  );

  // The provider answered — and billed — but the answer was unusable: the real
  // usage is SETTLED, never released, so the hard cap sees the money that left.
  const billed: [string, () => unknown][] = [
    ["refusal", () => new AiProviderError("refusal", BILLED)],
    ["truncation", () => new AiProviderError("max_tokens", BILLED)],
    ["malformed output", () => new AiProviderError("unparsed_output", BILLED)],
    ["schema mismatch", () => new AiProviderError("schema_mismatch", BILLED)],
    ["empty draft", () => new AiProviderError("empty_draft", BILLED)],
  ];

  it.each(billed)(
    "turns a %s into the one generic state but settles the billed usage",
    async (_name, makeError) => {
      const { spend, reserved, settled, settledUsage, released } = fakeSpend();
      const err = await expectApiError(
        withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
          throw makeError();
        }),
      );
      expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(err.message).toBe("AI assistance is unavailable.");
      expect(reserved).toHaveLength(1);
      expect(released).toEqual([]);
      expect(settled).toEqual(["ledger-1"]);
      expect(settledUsage[0]).toEqual({
        settledMicros: settlementMicros(AI_LIMITS, BILLED),
        inputTokens: BILLED.inputTokens,
        outputTokens: BILLED.outputTokens,
      });
    },
  );

  // We cannot know whether a timed-out request was processed: the reservation
  // stays open and counts at its worst-case estimate.
  const timeouts: [string, () => unknown][] = [
    ["timeout", () => new Anthropic.APIConnectionTimeoutError({ message: "timed out" })],
    ["deadline", () => new AiProviderError("deadline_exceeded")],
  ];

  it.each(timeouts)(
    "leaves the reservation open after a %s (neither settled nor released)",
    async (_name, makeError) => {
      const { spend, reserved, settled, released } = fakeSpend();
      const err = await expectApiError(
        withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
          throw makeError();
        }),
      );
      expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(reserved).toHaveLength(1);
      expect(settled).toEqual([]);
      expect(released).toEqual([]);
    },
  );

  it("logs one content-free line and never the label text, the base64 or a provider message", async () => {
    const secret = Buffer.from(LABEL_BYTES).toString("base64");
    const { spend } = fakeSpend();
    await expectApiError(
      withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
        throw new Anthropic.RateLimitError(
          429,
          undefined,
          `quota exceeded for GLUTEN-FREE ${secret.slice(0, 64)}`,
          new Headers(),
        );
      }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[ai] extract failed", {
      reason: "http_429",
      ledgerId: "ledger-1",
      disposition: "released",
    });
    const everything = JSON.stringify([
      warn.mock.calls,
      error.mock.calls,
      log.mock.calls,
    ]);
    expect(everything).not.toContain("GLUTEN-FREE");
    expect(everything).not.toContain(secret.slice(0, 32));
    expect(everything).not.toContain("quota exceeded");
  });

  it("settles the real usage on success and never releases", async () => {
    const { spend, settled, released } = fakeSpend();
    const result = await withSpend(
      "extract",
      spend,
      AI_LIMITS,
      reserveInput,
      async (): Promise<MeteredResult<string>> => ({
        result: "ok",
        usage: { inputTokens: 6_000, outputTokens: 400 },
      }),
    );
    expect(result).toBe("ok");
    expect(settled).toEqual(["ledger-1"]);
    expect(released).toEqual([]);
  });

  it("does not let a failed release mask the original failure", async () => {
    const { spend } = fakeSpend();
    spend.release = async () => {
      throw new Error("ledger unreachable");
    };
    const err = await expectApiError(
      withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
        throw new Anthropic.InternalServerError(503, undefined, "upstream", new Headers());
      }),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(err.message).toBe("AI assistance is unavailable.");
  });

  it("does not let a failed settlement mask the original failure", async () => {
    const { spend } = fakeSpend();
    spend.settle = async () => {
      throw new Error("ledger unreachable");
    };
    const err = await expectApiError(
      withSpend("extract", spend, AI_LIMITS, reserveInput, () => {
        throw new AiProviderError("refusal", BILLED);
      }),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(err.message).toBe("AI assistance is unavailable.");
  });
});

describe("extraction service checks (no provider, no ledger)", () => {
  it("refuses more evidence than the cap before touching the ledger", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: EV },
        { data: fakeData(), spend, adapter: fakeAdapter() },
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(reserved).toEqual([]);
  });

  it("refuses a repeated evidence id", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!, EV[0]!] },
        { data: fakeData(), spend, adapter: fakeAdapter() },
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(reserved).toEqual([]);
  });

  it.each([
    ["another report's evidence", evidenceRow(EV[0]!, { report_id: OTHER_REPORT_ID })],
    ["a receipt", evidenceRow(EV[0]!, { kind: "receipt", mime_type: "application/pdf" })],
    ["an unfinished upload", evidenceRow(EV[0]!, { upload_state: "pending" })],
    ["a PDF", evidenceRow(EV[0]!, { mime_type: "application/pdf" })],
  ])("refuses %s with one message that reveals nothing", async (_name, row) => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!] },
        { data: fakeData({ rows: [row] }), spend, adapter: fakeAdapter() },
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("Choose ready label photographs that belong to this report.");
    expect(reserved).toEqual([]);
  });

  it("refuses a missing evidence id with the same message", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[2]!] },
        { data: fakeData({ rows: [] }), spend, adapter: fakeAdapter() },
      ),
    );
    expect(err.message).toBe("Choose ready label photographs that belong to this report.");
    expect(reserved).toEqual([]);
  });

  it("refuses an oversized image before any reservation", async () => {
    const { spend, reserved } = fakeSpend();
    const limits: AiLimits = { ...AI_LIMITS, maxImageBytes: 10 };
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!] },
        { data: fakeData(), spend, adapter: fakeAdapter(), limits },
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("That photograph is too large to send.");
    expect(reserved).toEqual([]);
  });

  it("refuses bytes whose real type contradicts the stored type", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!] },
        {
          data: fakeData({
            rows: [evidenceRow(EV[0]!, { mime_type: "image/jpeg" })],
            bytes: samplePng(),
          }),
          spend,
          adapter: fakeAdapter(),
        },
      ),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(reserved).toEqual([]);
  });

  it("answers DEPENDENCY_UNAVAILABLE without a provider or a ledger row when AI is off", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!] },
        { data: fakeData(), spend, adapter: null },
      ),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(err.message).toBe("AI assistance is unavailable.");
    expect(reserved).toEqual([]);
  });

  it("returns the assisted contract shape and reserves against the adapter's model", async () => {
    const { spend, reserved, settled } = fakeSpend();
    const response = await extractForReport(
      "access-1",
      REPORT_ID,
      { evidence_ids: [EV[0]!, EV[1]!] },
      {
        data: fakeData(),
        spend,
        adapter: fakeAdapter({
          extractLabelMetered: async () => ({
            result: {
              brand: "Sample Pantry",
              productName: "Oat Crackers",
              unreadableFields: ["claim_text", "ingredients_text"],
            },
            usage: { inputTokens: 9_000, outputTokens: 200 },
          }),
        }),
      },
    );
    expect(response).toEqual({
      method: "assisted",
      evidence_ids: [EV[0], EV[1]],
      suggestions: {
        product_name: "Oat Crackers",
        brand: "Sample Pantry",
        claim_text: null,
        ingredients_text: null,
      },
      unreadable_fields: ["claim_text", "ingredients_text"],
    });
    expect(reserved[0]).toMatchObject({
      operation: "extract",
      channel: null,
      model: "test-model",
      reportId: REPORT_ID,
    });
    expect(reserved[0]!.reserveMicros).toBeLessThan(AI_LIMITS.perCallCapMicros);
    expect(settled).toEqual(["ledger-1"]);
  });

  it("treats an off-contract unreadable field as a provider failure and settles the billed usage", async () => {
    const { spend, settled, released } = fakeSpend();
    const err = await expectApiError(
      extractForReport(
        "access-1",
        REPORT_ID,
        { evidence_ids: [EV[0]!] },
        {
          data: fakeData(),
          spend,
          adapter: fakeAdapter({
            extractLabelMetered: async () => ({
              result: { unreadableFields: ["something_else"] },
              usage: { inputTokens: 1, outputTokens: 1 },
            }),
          }),
        },
      ),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    // The adapter answered, so the provider billed it: settled, not released.
    expect(settled).toEqual(["ledger-1"]);
    expect(released).toEqual([]);
  });
});

describe("drafting service checks (no provider, no ledger)", () => {
  it("requires confirmed facts before anything is reserved", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      draftForReport("access-1", REPORT_ID, "brand", {
        data: fakeData({ report: baseReport({ facts_confirmed_at: null }) }),
        spend,
        adapter: fakeAdapter(),
      }),
    );
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.message).toBe("Confirm the label facts before drafting.");
    expect(reserved).toEqual([]);
  });

  it("answers DEPENDENCY_UNAVAILABLE without a ledger row when AI is off", async () => {
    const { spend, reserved } = fakeSpend();
    const err = await expectApiError(
      draftForReport("access-1", REPORT_ID, "brand", {
        data: fakeData(),
        spend,
        adapter: null,
      }),
    );
    expect(err.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(reserved).toEqual([]);
  });

  it("builds the facts only from the stored row and re-asserts the sample notice", async () => {
    const { spend, reserved } = fakeSpend();
    let seen: unknown;
    const response = await draftForReport("access-1", REPORT_ID, "government", {
      data: fakeData(),
      spend,
      adapter: fakeAdapter({
        draftComplaintMetered: async (facts, channel) => {
          seen = { facts, channel };
          return {
            result: { subject: "Consumer grievance", body: "Please review the label." },
            usage: { inputTokens: 1_200, outputTokens: 500 },
          };
        },
      }),
    });
    expect(seen).toEqual({
      channel: "government",
      facts: {
        productName: "Oat Crackers",
        brand: "Sample Pantry",
        variant: null,
        observationDate: "2026-08-01",
        claimText: "Gluten-free",
        ingredientsText: "Oat flour, sunflower oil, salt",
        concernText: "The pack claims gluten-free but lists oat flour.",
      },
    });
    expect(response.method).toBe("assisted");
    expect(response.channel).toBe("government");
    expect(response.body.startsWith("SAMPLE / DEMONSTRATION CONTENT")).toBe(true);
    expect(response.body.trimEnd().endsWith("real brand or authority.")).toBe(true);
    expect(response.body).toContain("Please review the label.");
    expect(reserved[0]).toMatchObject({ operation: "draft", channel: "government" });
  });
});

describe("provider configuration", () => {
  const saved = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PROVIDER_API_KEY: process.env.AI_PROVIDER_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
  };
  const setEnv = (env: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  afterEach(() => {
    setEnv(saved);
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("is switched off unless both the provider and the key are set", async () => {
    for (const env of [
      { AI_PROVIDER: undefined, AI_PROVIDER_API_KEY: undefined },
      { AI_PROVIDER: "anthropic", AI_PROVIDER_API_KEY: undefined },
      { AI_PROVIDER: undefined, AI_PROVIDER_API_KEY: "unused-in-this-test" },
      { AI_PROVIDER: "some-other-provider", AI_PROVIDER_API_KEY: "unused-in-this-test" },
    ]) {
      setEnv({ ...env, AI_MODEL: undefined });
      vi.resetModules();
      const { getAiAdapter, isAiConfigured } = await import("@/lib/server/ai");
      expect(getAiAdapter()).toBeNull();
      expect(isAiConfigured()).toBe(false);
    }
  });

  it("is switched off for a model that has no price row, so the cap can never under-count", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    setEnv({
      AI_PROVIDER: "anthropic",
      AI_PROVIDER_API_KEY: "unused-in-this-test",
      AI_MODEL: "some-unpriced-model",
    });
    vi.resetModules();
    const { getAiAdapter, isAiConfigured } = await import("@/lib/server/ai");
    expect(isAiConfigured()).toBe(false);
    expect(getAiAdapter()).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("unused-in-this-test");
  });

  it("is on for the priced default model and reports the model it will meter", async () => {
    setEnv({
      AI_PROVIDER: "anthropic",
      AI_PROVIDER_API_KEY: "unused-in-this-test",
      AI_MODEL: undefined,
    });
    vi.resetModules();
    const { getAiAdapter, isAiConfigured, DEFAULT_AI_MODEL } = await import("@/lib/server/ai");
    expect(isAiConfigured()).toBe(true);
    // Constructing the client performs no network call.
    expect(getAiAdapter()?.model).toBe(DEFAULT_AI_MODEL);
  });
});
