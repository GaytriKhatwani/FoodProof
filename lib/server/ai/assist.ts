import "server-only";
import {
  AiDraftResponse,
  AiExtractResponse,
  type AiExtractRequest,
  type Channel,
} from "@/lib/contracts";
import { ApiError } from "../errors";
import { getServiceClient } from "../supabase";
import { loadOwnedReport } from "../data";
import { evidenceStorage } from "../storage";
import { sniffMime } from "../image";
import { SAMPLE_NOTICE } from "../drafts";
import {
  getAiAdapter,
  type ConfirmedFacts,
  type MeteredAiAdapter,
  type MeteredResult,
} from "../ai";
import {
  AI_LIMITS,
  reservationMicros,
  settlementMicros,
  type AiImageMime,
  type AiLimits,
} from "./limits";
import {
  AiProviderError,
  draftPromptCharacters,
  extractPromptCharacters,
} from "./anthropic";
import {
  aiSpend,
  type AiOperation,
  type AiSpendLedger,
  type ReserveInput,
} from "./spend";

/**
 * Assisted extraction and drafting (FOODPROOF_API_DETAILS.md "AI endpoints").
 *
 * Every ownership, evidence and configuration check runs BEFORE any money is
 * reserved and long before the provider is contacted. The client supplies only
 * owned evidence ids or a channel: never a URL, a prompt, a model or a provider
 * parameter. Nothing here is persisted — extraction never confirms facts and
 * drafting never saves a draft; both are separate, explicit user actions.
 *
 * Every provider-side failure — timeout, rate limit, server error, connection,
 * refusal, truncation, malformed or schema-invalid output — becomes the single
 * honest state "AI assistance is unavailable." The provider's own message,
 * status body and stack never reach the client, and one content-free line is
 * logged per failure.
 */

const GENERIC_UNAVAILABLE = () =>
  new ApiError("DEPENDENCY_UNAVAILABLE", "AI assistance is unavailable.");

/**
 * One message for a missing id, another reporter's evidence, the wrong kind,
 * an unfinished upload and an unsupported type alike: the answer must not reveal
 * whether an id exists.
 */
const UNUSABLE_EVIDENCE = () =>
  new ApiError(
    "VALIDATION_FAILED",
    "Choose ready label photographs that belong to this report.",
  );

// ---------------------------------------------------------------------------
// Data seam. The default reads the demo Supabase project; tests substitute it
// so the failure/ledger paths can be exercised without a network.
// ---------------------------------------------------------------------------

export interface AssistReport {
  brand: string;
  product_name: string;
  variant: string | null;
  observation_date: string | null;
  concern_text: string | null;
  claim_text: string | null;
  ingredients_text: string | null;
  facts_confirmed_at: string | null;
}

export interface AssistEvidenceRow {
  id: string;
  report_id: string;
  kind: string;
  mime_type: string;
  bytes: number;
  upload_state: string;
  object_path: string;
}

export interface AssistData {
  /** Throws NOT_FOUND for a missing report AND for another owner's report. */
  loadReport(accessId: string, reportId: string): Promise<AssistReport>;
  loadEvidenceRows(evidenceIds: string[]): Promise<AssistEvidenceRow[]>;
  readImageBytes(objectPath: string): Promise<Uint8Array>;
}

export const supabaseAssistData: AssistData = {
  loadReport(accessId, reportId) {
    return loadOwnedReport(accessId, reportId, getServiceClient());
  },
  async loadEvidenceRows(evidenceIds) {
    const { data, error } = await getServiceClient()
      .from("evidence")
      .select("id, report_id, kind, mime_type, bytes, upload_state, object_path")
      .in("id", evidenceIds);
    if (error) throw error;
    return (data ?? []) as AssistEvidenceRow[];
  },
  readImageBytes(objectPath) {
    return evidenceStorage.readBytes(objectPath);
  },
};

export interface AssistDeps {
  /** `null` means "configured off"; omitted means "resolve from the environment". */
  adapter?: MeteredAiAdapter | null;
  limits?: AiLimits;
  spend?: AiSpendLedger;
  data?: AssistData;
}

// ---------------------------------------------------------------------------
// Metering
// ---------------------------------------------------------------------------

/** A short, content-free label for the server log. Never a provider message. */
function failureReason(e: unknown): string {
  if (e instanceof AiProviderError) return e.reason;
  if (e && typeof e === "object") {
    const status = (e as { status?: unknown }).status;
    if (typeof status === "number") return `http_${status}`;
    const name = (e as { constructor?: { name?: string } }).constructor?.name;
    if (name) return name;
  }
  return "unknown";
}

/**
 * Hard backstop around the provider call. The SDK client already carries a
 * per-attempt `timeout` and `maxRetries: 1`, so two attempts plus a little slack
 * is the longest a call may legitimately take; this guarantees the route answers
 * even if the SDK never settles its promise.
 */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiProviderError("deadline_exceeded")), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Reserve, call, then settle the real cost or release the reservation. Exported
 * so the failure matrix can be tested without a provider or a database.
 *
 * A failure releases exactly once and never settles, so an immediate retry is
 * not charged twice. If settlement itself fails the reservation deliberately
 * stays open — the call did cost money, and counting it at the estimate is the
 * safe direction for the pilot's hard cap.
 */
export async function withSpend<T>(
  operation: AiOperation,
  spend: AiSpendLedger,
  limits: AiLimits,
  reserveInput: ReserveInput,
  call: () => Promise<MeteredResult<T>>,
): Promise<T> {
  const reservation = await spend.reserve(reserveInput, limits);

  let outcome: MeteredResult<T>;
  try {
    outcome = await withDeadline(call(), limits.timeoutMs * 2 + 2_000);
  } catch (e) {
    console.warn(`[ai] ${operation} failed`, {
      reason: failureReason(e),
      ledgerId: reservation.ledgerId,
    });
    try {
      await spend.release(reservation.ledgerId);
    } catch (releaseError) {
      // Never mask the original failure with a cleanup failure.
      console.warn(`[ai] ${operation} release failed`, {
        reason: failureReason(releaseError),
        ledgerId: reservation.ledgerId,
      });
    }
    throw GENERIC_UNAVAILABLE();
  }

  await spend.settle(reservation.ledgerId, {
    settledMicros: settlementMicros(limits, outcome.usage),
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
  });
  return outcome.result;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface LoadedImage {
  evidenceId: string;
  bytes: Uint8Array;
  mimeType: AiImageMime;
}

function isAllowedMime(limits: AiLimits, mime: string): mime is AiImageMime {
  return (limits.allowedImageMimeTypes as readonly string[]).includes(mime);
}

export async function extractForReport(
  accessId: string,
  reportId: string,
  body: AiExtractRequest,
  deps?: AssistDeps,
): Promise<AiExtractResponse> {
  const limits = deps?.limits ?? AI_LIMITS;
  const data = deps?.data ?? supabaseAssistData;
  const spend = deps?.spend ?? aiSpend;

  // 1. The caller owns the report (NOT_FOUND hides every other report).
  await data.loadReport(accessId, reportId);

  // 2. The requested evidence is a small, unique set of this report's own ready
  //    label images, of an allowed type, within the size cap, whose bytes really
  //    are that type. All of this precedes any reservation or provider call.
  const evidenceIds = body.evidence_ids;
  if (evidenceIds.length > limits.maxEvidencePerCall) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `Send at most ${limits.maxEvidencePerCall} label photographs at a time.`,
    );
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new ApiError("VALIDATION_FAILED", "List each photograph once.");
  }

  const rows = await data.loadEvidenceRows(evidenceIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const images: LoadedImage[] = [];
  for (const evidenceId of evidenceIds) {
    const row = byId.get(evidenceId);
    if (
      !row ||
      row.report_id !== reportId ||
      row.upload_state !== "ready" ||
      row.kind !== "label" ||
      !isAllowedMime(limits, row.mime_type)
    ) {
      throw UNUSABLE_EVIDENCE();
    }
    if (row.bytes > limits.maxImageBytes) {
      throw new ApiError("VALIDATION_FAILED", "That photograph is too large to send.");
    }
    const bytes = await data.readImageBytes(row.object_path);
    if (bytes.length > limits.maxImageBytes) {
      throw new ApiError("VALIDATION_FAILED", "That photograph is too large to send.");
    }
    const sniffed = sniffMime(bytes);
    if (!sniffed || sniffed !== row.mime_type || !isAllowedMime(limits, sniffed)) {
      throw UNUSABLE_EVIDENCE();
    }
    images.push({ evidenceId, bytes, mimeType: sniffed });
  }

  // 3. The provider must be configured. Otherwise the reporter continues
  //    manually and nothing is reserved.
  const adapter =
    deps?.adapter !== undefined
      ? deps.adapter
      : getAiAdapter({
          limits,
          // Only these validated, owned images can ever reach the provider.
          loadImage: async (id) => {
            const image = images.find((i) => i.evidenceId === id);
            if (!image) throw new AiProviderError("image_missing");
            return { bytes: image.bytes, mimeType: image.mimeType };
          },
        });
  if (!adapter) throw GENERIC_UNAVAILABLE();

  // 4. Reserve, call, settle or release.
  return withSpend(
    "extract",
    spend,
    limits,
    {
      accessId,
      reportId,
      operation: "extract",
      channel: null,
      model: adapter.model,
      reserveMicros: reservationMicros(limits, {
        imageCount: evidenceIds.length,
        promptCharacters: extractPromptCharacters(evidenceIds.length),
        maxOutputTokens: limits.maxOutputTokensExtract,
      }),
    },
    async () => {
      const metered = await adapter.extractLabelMetered(evidenceIds);
      const parsed = AiExtractResponse.safeParse({
        method: "assisted",
        evidence_ids: evidenceIds,
        suggestions: {
          product_name: metered.result.productName ?? null,
          brand: metered.result.brand ?? null,
          claim_text: metered.result.claimText ?? null,
          ingredients_text: metered.result.ingredientsText ?? null,
        },
        unreadable_fields: metered.result.unreadableFields,
      });
      // A partial or off-contract result is a failure, not a half-answer.
      if (!parsed.success) throw new AiProviderError("contract_mismatch");
      return { result: parsed.data, usage: metered.usage };
    },
  );
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

/**
 * Guarantee the sample label the demo requires, in the same words the
 * deterministic template uses, whatever the provider returned.
 */
function withSampleNotice(body: string): string {
  const trimmed = body.trim();
  const parts: string[] = [];
  if (!trimmed.startsWith(SAMPLE_NOTICE)) parts.push(SAMPLE_NOTICE, "");
  parts.push(trimmed);
  if (!trimmed.endsWith(SAMPLE_NOTICE)) parts.push("", SAMPLE_NOTICE);
  return parts.join("\n");
}

export async function draftForReport(
  accessId: string,
  reportId: string,
  channel: Channel,
  deps?: AssistDeps,
): Promise<AiDraftResponse> {
  const limits = deps?.limits ?? AI_LIMITS;
  const data = deps?.data ?? supabaseAssistData;
  const spend = deps?.spend ?? aiSpend;

  const report = await data.loadReport(accessId, reportId);
  // Same rule as the deterministic template: nothing is drafted from unconfirmed
  // facts (FOODPROOF_TECHNICAL_SPEC.md §8).
  if (!report.facts_confirmed_at) {
    throw new ApiError("VALIDATION_FAILED", "Confirm the label facts before drafting.");
  }

  // Built only from the stored report row — never from the request body.
  const confirmedFacts: ConfirmedFacts = {
    productName: report.product_name,
    brand: report.brand,
    variant: report.variant,
    observationDate: report.observation_date,
    claimText: report.claim_text,
    ingredientsText: report.ingredients_text,
    concernText: report.concern_text ?? "",
  };

  const adapter =
    deps?.adapter !== undefined ? deps.adapter : getAiAdapter({ limits });
  if (!adapter) throw GENERIC_UNAVAILABLE();

  return withSpend(
    "draft",
    spend,
    limits,
    {
      accessId,
      reportId,
      operation: "draft",
      channel,
      model: adapter.model,
      reserveMicros: reservationMicros(limits, {
        imageCount: 0,
        promptCharacters: draftPromptCharacters(confirmedFacts),
        maxOutputTokens: limits.maxOutputTokensDraft,
      }),
    },
    async () => {
      const metered = await adapter.draftComplaintMetered(confirmedFacts, channel);
      const parsed = AiDraftResponse.safeParse({
        method: "assisted",
        channel,
        subject: metered.result.subject.trim(),
        body: withSampleNotice(metered.result.body),
      });
      if (!parsed.success || !parsed.data.subject) {
        throw new AiProviderError("contract_mismatch");
      }
      return { result: parsed.data, usage: metered.usage };
    },
  );
}
