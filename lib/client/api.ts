import {
  isApiError,
  type ApiResult,
  type ErrorCode,
  type Me,
  type ReportSummary,
  type ReportDetail,
  type EvidenceMeta,
  type ComplaintDraft,
  type Submission,
  type ReportUpdate,
  type ReviewRequestState,
  type ReviewQueueItem,
  type PublicFeedItem,
  type PublicReport,
  type SessionCreateRequest,
  type AnalyticsConsentRequest,
  type ReportWriteRequest,
  type ConfirmFactsRequest,
  type EvidenceRolesPatch,
  type PrepareRequest,
  type ComplaintDraftWriteRequest,
  type SubmissionCreateRequest,
  type UpdateCreateRequest,
  type CloseRequest,
  type PublicationRequest,
  type ReviewDecisionRequest,
  type RelinkRequest,
  type FlagRequest,
  type ClientAnalyticsEventRequest,
  type AiExtractRequest,
  type AiExtractResponse,
  type AiDraftRequest,
  type AiDraftResponse,
  type Channel,
  type EvidenceRole,
} from "@/lib/contracts";

/**
 * Browser-safe typed client API adapter over the frozen HTTP contract
 * (FOODPROOF_TECHNICAL_SPEC.md §6). No `server-only` import and no Supabase
 * import — this module is safe to bundle into client components. UI code
 * (T2/T3) should call the API only through the `api` object below, never with
 * a raw `fetch`, so the envelope, error mapping and idempotency convention
 * stay in one place.
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface ClientApiErrorInit {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  requestId: string | null;
  status: number;
  retryAfterSeconds: number | null;
}

/**
 * Thrown by `apiFetch` for every non-success outcome: a parsed API error
 * envelope, a network failure, or a non-JSON response. UI code should catch
 * this type and branch on `code`/`status` rather than parsing messages.
 */
export class ClientApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;
  readonly requestId: string | null;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(init: ClientApiErrorInit) {
    super(init.message);
    this.name = "ClientApiError";
    this.code = init.code;
    this.fields = init.fields;
    this.requestId = init.requestId;
    this.status = init.status;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

function retryAfterFromHeaders(headers: Headers): number | null {
  const raw = headers.get("Retry-After");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// apiFetch: the single fetch/envelope boundary
// ---------------------------------------------------------------------------

/**
 * Call a route under `/api/**` and unwrap the uniform envelope. Always sends
 * cookies (`credentials: "same-origin"`), always accepts JSON, and sets
 * `Content-Type: application/json` for a JSON body while leaving a `FormData`
 * body's boundary to the browser. Throws `ClientApiError` for every error
 * envelope, network failure, or non-JSON response — it never returns a
 * partially-parsed or ambiguous result, and it never swallows an error.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  if (init.body != null && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin", headers });
  } catch {
    // Network failure: offline, DNS, connection refused, aborted, etc.
    throw new ClientApiError({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "The service is unavailable right now. Check your connection and try again.",
      requestId: null,
      status: 0,
      retryAfterSeconds: null,
    });
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (proxy error page, empty body, etc.) — never surface
    // an unparsed body to the UI.
    throw new ClientApiError({
      code: "DEPENDENCY_UNAVAILABLE",
      message: "The service returned an unexpected response. Please try again.",
      requestId: null,
      status: res.status,
      retryAfterSeconds: null,
    });
  }

  const result = body as ApiResult<T>;
  if (isApiError(result)) {
    throw new ClientApiError({
      code: result.error.code,
      message: result.error.message,
      fields: result.error.fields,
      requestId: result.request_id,
      status: res.status,
      retryAfterSeconds: retryAfterFromHeaders(res.headers),
    });
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Idempotency-Key convention
// ---------------------------------------------------------------------------

/**
 * Generate a fresh Idempotency-Key. Convention: the UI generates ONE key per
 * logical user action (e.g. "save this report", "upload this file") and
 * reuses the SAME key across any retry of that exact action — a repeated
 * request with the same key and body replays the original result instead of
 * creating a duplicate record; a repeated key with a different body is a
 * 409 CONFLICT (see lib/server/idempotency.ts). Generate a NEW key only when
 * starting a new logical action, not on every retry.
 */
export function idempotencyKey(): string {
  return crypto.randomUUID();
}

/** Attach an Idempotency-Key header to a request init, generating one if omitted. */
export function withIdempotencyKey(init: RequestInit = {}, key: string = idempotencyKey()): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Idempotency-Key", key);
  return { ...init, headers };
}

// ---------------------------------------------------------------------------
// Local response/request types for routes whose shape is not exported from
// lib/contracts. Each is typed from the route's actual `jsonOk(...)` payload
// (or its service function's return type) — never invented.
// ---------------------------------------------------------------------------

/** POST /api/demo/session — see app/api/demo/session/route.ts. */
export type SessionCreateResponse = Pick<Me, "label" | "role"> & { expires_at: string };

/** DELETE /api/demo/session — see app/api/demo/session/route.ts. */
export interface SessionDestroyResponse {
  ended: true;
}

/** PUT /api/me/analytics-consent — see app/api/me/analytics-consent/route.ts. */
export interface AnalyticsConsentResponse {
  analytics_consent: boolean;
}

/** POST /api/analytics — see lib/server/analytics.ts ingestClientEvent(). */
export interface AnalyticsIngestResponse {
  accepted: boolean;
}

/** GET /api/reports — see lib/server/data.ts listOwnReports(). */
export interface ReportListResponse {
  items: ReportSummary[];
  next_cursor: string | null;
}

/** GET /api/feed — see lib/server/data.ts getFeed(). */
export interface FeedListResponse {
  items: PublicFeedItem[];
  next_cursor: string | null;
}

/** POST /api/reports/:id/prepare — see lib/server/drafts.ts prepareDraft(). */
export interface PrepareDraftResponse {
  channel: Channel;
  subject: string;
  body: string;
  method: "template";
}

/** DELETE /api/evidence/:id — see lib/server/evidence.ts removeEvidence(). */
export interface EvidenceRemovedResponse {
  evidence_id: string;
  removed: true;
}

/** POST /api/reports/:id/withdraw — see lib/server/publication.ts withdrawPublication(). */
export interface WithdrawResponse {
  report_id: string;
  withdrawn: true;
  /** True when a visible publication was hidden by this call (T4, migration 0004). */
  hidden: boolean;
  /** The approved concern revision that was hidden, or null when nothing was visible. */
  publication_revision_id: string | null;
  withdrawn_at: string;
}

/**
 * Analytics flow correlation for report saves (FOODPROOF_MEASUREMENT_AND_PILOT.md
 * §4 `report_saved.flow_id`). The UI generates one random UUID per editor
 * session and sends it as the `X-Flow-Id` header; the server joins it to the
 * server-owned `report_saved` event. It is never a request-body field and the
 * server ignores anything that is not a UUID.
 */
export const FLOW_ID_HEADER = "X-Flow-Id";

function withFlowId(init: RequestInit, flowId?: string): RequestInit {
  if (!flowId) return init;
  const headers = new Headers(init.headers);
  headers.set(FLOW_ID_HEADER, flowId);
  return { ...init, headers };
}

/** POST /api/feed/:id/flags — see lib/server/publication.ts raiseFlag(). */
export interface FlagCreatedResponse {
  flag_id: string;
}

/** POST /api/review/flags/:id/resolve — see lib/server/publication.ts resolveFlag(). */
export interface FlagResolvedResponse {
  flag_id: string;
  state: "handled";
  report_id: string;
  /** True when the resolution also removed the published content (T4, migration 0004). */
  removed: boolean;
  publication_revision_id: string | null;
  removed_at: string | null;
}

/** Request body for POST /api/review/flags/:id/resolve — a local schema in that route file, not in lib/contracts. */
export interface FlagResolveRequestBody {
  note?: string;
  remove?: boolean;
}

/** POST /api/review/reports/:id/remove — see lib/server/publication.ts removeContent(). */
export interface RemoveContentResponse {
  report_id: string;
  removed: true;
  /** The approved revision that was hidden, or null when nothing was visible (T4, migration 0004). */
  publication_revision_id: string | null;
  removed_at: string | null;
}

/** Request body for POST /api/review/reports/:id/remove — a local schema in that route file, not in lib/contracts. */
export interface ReviewRemoveRequestBody {
  reason: string;
}

/** POST /api/review/reports/:id/relink — see lib/server/publication.ts relinkProduct(). */
export interface RelinkResponse {
  report_id: string;
  product_id: string;
}

/** GET /api/review/queue — see lib/server/data.ts getReviewQueue(). */
export interface ReviewQueueFlag {
  id: string;
  report_id: string;
  reason: string;
  created_at: string;
}
export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  flags: ReviewQueueFlag[];
}

/** GET /api/review/:revisionId — see lib/server/data.ts getReviewDetail(). */
export interface ReviewDetailResponse {
  publication_revision_id: string;
  report_id: string;
  content_kind: "concern" | "response";
  state: string;
  revision: number;
  reason: string | null;
  payload: unknown;
  asset_ids: string[];
  created_at: string;
  /** send as `expected_version` on the decision */
  version: number;
}

/** GET /api/products/matches — see lib/server/products.ts ProductMatch/matchProducts(). */
export interface ProductMatch {
  product_id: string;
  brand: string;
  name: string;
  variant: string | null;
}
export interface ProductMatchesResponse {
  matches: ProductMatch[];
}

/** Multipart form input for POST /api/reports/:id/evidence — see that route file for field names. */
export interface EvidenceUploadInput {
  file: Blob;
  kind: "label" | "receipt" | "acknowledgement" | "response";
  roles?: EvidenceRole[];
}

// ---------------------------------------------------------------------------
// Typed API surface, grouped by resource. One function per route.
// ---------------------------------------------------------------------------

export const api = {
  session: {
    /** POST /api/demo/session — no Idempotency-Key. */
    create(invitationCode: string): Promise<SessionCreateResponse> {
      const body: SessionCreateRequest = { invitation_code: invitationCode };
      return apiFetch<SessionCreateResponse>("/api/demo/session", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** DELETE /api/demo/session — no Idempotency-Key. */
    destroy(): Promise<SessionDestroyResponse> {
      return apiFetch<SessionDestroyResponse>("/api/demo/session", { method: "DELETE" });
    },
  },

  me: {
    /** GET /api/me — no Idempotency-Key. */
    get(): Promise<Me> {
      return apiFetch<Me>("/api/me");
    },
    /** PUT /api/me/analytics-consent — no Idempotency-Key (never cached as a receipt). */
    setAnalyticsConsent(allowed: boolean): Promise<AnalyticsConsentResponse> {
      const body: AnalyticsConsentRequest = { allowed };
      return apiFetch<AnalyticsConsentResponse>("/api/me/analytics-consent", {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
  },

  analytics: {
    /**
     * POST /api/analytics — no Idempotency-Key. Prefer the `clientAnalytics`
     * adapter in `lib/analytics` for UI event emission (it never throws);
     * this is the raw typed call for that adapter to build on.
     */
    send(event: ClientAnalyticsEventRequest, init: RequestInit = {}): Promise<AnalyticsIngestResponse> {
      return apiFetch<AnalyticsIngestResponse>("/api/analytics", {
        ...init,
        method: "POST",
        body: JSON.stringify(event),
      });
    },
  },

  reports: {
    /** GET /api/reports?cursor= — no Idempotency-Key. */
    list(cursor?: string): Promise<ReportListResponse> {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return apiFetch<ReportListResponse>(`/api/reports${qs}`);
    },
    /** POST /api/reports — requires Idempotency-Key; optional `flowId` → `X-Flow-Id`. */
    create(
      body: ReportWriteRequest,
      key: string,
      opts: { flowId?: string } = {},
    ): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(
        "/api/reports",
        withFlowId(
          withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
          opts.flowId,
        ),
      );
    },
    /** GET /api/reports/:id — no Idempotency-Key. */
    get(reportId: string): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(`/api/reports/${reportId}`);
    },
    /** PATCH /api/reports/:id — requires Idempotency-Key; optional `flowId` → `X-Flow-Id`. */
    patch(
      reportId: string,
      body: ReportWriteRequest,
      key: string,
      opts: { flowId?: string } = {},
    ): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(
        `/api/reports/${reportId}`,
        withFlowId(
          withIdempotencyKey({ method: "PATCH", body: JSON.stringify(body) }, key),
          opts.flowId,
        ),
      );
    },
    /** POST /api/reports/:id/confirm-facts — requires Idempotency-Key. */
    confirmFacts(reportId: string, body: ConfirmFactsRequest, key: string): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(
        `/api/reports/${reportId}/confirm-facts`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
    /** POST /api/reports/:id/prepare — no Idempotency-Key (never saves, deterministic template). */
    prepare(reportId: string, body: PrepareRequest): Promise<PrepareDraftResponse> {
      return apiFetch<PrepareDraftResponse>(`/api/reports/${reportId}/prepare`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /** POST /api/reports/:id/close — requires Idempotency-Key. */
    close(reportId: string, body: CloseRequest, key: string): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(
        `/api/reports/${reportId}/close`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
    /** POST /api/reports/:id/reopen — requires Idempotency-Key. */
    reopen(reportId: string, key: string): Promise<ReportDetail> {
      return apiFetch<ReportDetail>(
        `/api/reports/${reportId}/reopen`,
        withIdempotencyKey({ method: "POST" }, key),
      );
    },
    /** POST /api/reports/:id/withdraw — requires Idempotency-Key. */
    withdraw(reportId: string, key: string): Promise<WithdrawResponse> {
      return apiFetch<WithdrawResponse>(
        `/api/reports/${reportId}/withdraw`,
        withIdempotencyKey({ method: "POST" }, key),
      );
    },
  },

  evidence: {
    /** POST /api/reports/:id/evidence — multipart, requires Idempotency-Key. */
    upload(reportId: string, input: EvidenceUploadInput, key: string): Promise<EvidenceMeta> {
      const form = new FormData();
      form.set("file", input.file);
      form.set("kind", input.kind);
      if (input.roles && input.roles.length > 0) form.set("roles", JSON.stringify(input.roles));
      return apiFetch<EvidenceMeta>(
        `/api/reports/${reportId}/evidence`,
        withIdempotencyKey({ method: "POST", body: form }, key),
      );
    },
    /** PATCH /api/evidence/:id — requires Idempotency-Key. */
    patchRoles(evidenceId: string, body: EvidenceRolesPatch, key: string): Promise<EvidenceMeta> {
      return apiFetch<EvidenceMeta>(
        `/api/evidence/${evidenceId}`,
        withIdempotencyKey({ method: "PATCH", body: JSON.stringify(body) }, key),
      );
    },
    /** DELETE /api/evidence/:id — requires Idempotency-Key. */
    remove(evidenceId: string, key: string): Promise<EvidenceRemovedResponse> {
      return apiFetch<EvidenceRemovedResponse>(
        `/api/evidence/${evidenceId}`,
        withIdempotencyKey({ method: "DELETE" }, key),
      );
    },
  },

  complaintDrafts: {
    /**
     * PUT /api/reports/:id/complaint-drafts/:channel — requires Idempotency-Key.
     * There is no standalone GET for a single draft; drafts are read back via
     * `reports.get(reportId).complaint_drafts` (see final report — this
     * surprised the integration slice; the task brief assumed a GET existed).
     */
    save(
      reportId: string,
      channel: Channel,
      body: ComplaintDraftWriteRequest,
      key: string,
    ): Promise<ComplaintDraft> {
      return apiFetch<ComplaintDraft>(
        `/api/reports/${reportId}/complaint-drafts/${channel}`,
        withIdempotencyKey({ method: "PUT", body: JSON.stringify(body) }, key),
      );
    },
  },

  submissions: {
    /** POST /api/reports/:id/submissions — requires Idempotency-Key. */
    create(reportId: string, body: SubmissionCreateRequest, key: string): Promise<Submission> {
      return apiFetch<Submission>(
        `/api/reports/${reportId}/submissions`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
  },

  updates: {
    /** POST /api/reports/:id/updates — requires Idempotency-Key. */
    create(reportId: string, body: UpdateCreateRequest, key: string): Promise<ReportUpdate> {
      return apiFetch<ReportUpdate>(
        `/api/reports/${reportId}/updates`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
  },

  publicationRequests: {
    /** POST /api/reports/:id/publication-requests — requires Idempotency-Key. */
    create(reportId: string, body: PublicationRequest, key: string): Promise<ReviewRequestState> {
      return apiFetch<ReviewRequestState>(
        `/api/reports/${reportId}/publication-requests`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
  },

  ai: {
    /**
     * POST /api/reports/:id/ai/extract — owner only; no Idempotency-Key. Nothing
     * is persisted: the response is a SUGGESTION the reporter applies and then
     * confirms through `reports.confirmFacts` (`method: "assisted"`). Every
     * failure (provider, timeout, budget, missing configuration, rate limit)
     * arrives as a ClientApiError and the UI shows exactly
     * "AI assistance unavailable—continue manually." — never a provider message.
     */
    extract(reportId: string, body: AiExtractRequest): Promise<AiExtractResponse> {
      return apiFetch<AiExtractResponse>(`/api/reports/${reportId}/ai/extract`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    /**
     * POST /api/reports/:id/ai/draft — owner only; no Idempotency-Key. Returns an
     * EDITABLE suggestion; saving is the separate `complaintDrafts.save` with
     * `method: "assisted"`. Failure semantics as `extract`.
     */
    draft(reportId: string, body: AiDraftRequest): Promise<AiDraftResponse> {
      return apiFetch<AiDraftResponse>(`/api/reports/${reportId}/ai/draft`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  },

  products: {
    /** GET /api/products/matches?brand=&name=&variant= — no Idempotency-Key. */
    matches(query: { brand: string; name: string; variant?: string }): Promise<ProductMatchesResponse> {
      const sp = new URLSearchParams({ brand: query.brand, name: query.name });
      if (query.variant) sp.set("variant", query.variant);
      return apiFetch<ProductMatchesResponse>(`/api/products/matches?${sp.toString()}`);
    },
  },

  feed: {
    /** GET /api/feed?q=&cursor= — no Idempotency-Key. */
    list(query: { q?: string; cursor?: string } = {}): Promise<FeedListResponse> {
      const sp = new URLSearchParams();
      if (query.q) sp.set("q", query.q);
      if (query.cursor) sp.set("cursor", query.cursor);
      const qs = sp.toString();
      return apiFetch<FeedListResponse>(`/api/feed${qs ? `?${qs}` : ""}`);
    },
    /** GET /api/feed/:id — no Idempotency-Key. */
    get(reportId: string): Promise<PublicReport> {
      return apiFetch<PublicReport>(`/api/feed/${reportId}`);
    },
    /** POST /api/feed/:id/flags — requires Idempotency-Key. */
    flag(reportId: string, body: FlagRequest, key: string): Promise<FlagCreatedResponse> {
      return apiFetch<FlagCreatedResponse>(
        `/api/feed/${reportId}/flags`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
  },

  review: {
    /** GET /api/review/queue — reviewer only, no Idempotency-Key. */
    queue(): Promise<ReviewQueueResponse> {
      return apiFetch<ReviewQueueResponse>("/api/review/queue");
    },
    /** GET /api/review/:revisionId — reviewer only, no Idempotency-Key. */
    detail(revisionId: string): Promise<ReviewDetailResponse> {
      return apiFetch<ReviewDetailResponse>(`/api/review/${revisionId}`);
    },
    /** POST /api/review/:revisionId/decision — reviewer only, requires Idempotency-Key. */
    decide(revisionId: string, body: ReviewDecisionRequest, key: string): Promise<ReviewRequestState> {
      return apiFetch<ReviewRequestState>(
        `/api/review/${revisionId}/decision`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
    /** POST /api/review/reports/:id/relink — reviewer only, requires Idempotency-Key. */
    relink(reportId: string, body: RelinkRequest, key: string): Promise<RelinkResponse> {
      return apiFetch<RelinkResponse>(
        `/api/review/reports/${reportId}/relink`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
    /** POST /api/review/reports/:id/remove — reviewer only, requires Idempotency-Key. */
    remove(reportId: string, body: ReviewRemoveRequestBody, key: string): Promise<RemoveContentResponse> {
      return apiFetch<RemoveContentResponse>(
        `/api/review/reports/${reportId}/remove`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
    /** POST /api/review/flags/:id/resolve — reviewer only, requires Idempotency-Key. */
    resolveFlag(flagId: string, body: FlagResolveRequestBody, key: string): Promise<FlagResolvedResponse> {
      return apiFetch<FlagResolvedResponse>(
        `/api/review/flags/${flagId}/resolve`,
        withIdempotencyKey({ method: "POST", body: JSON.stringify(body) }, key),
      );
    },
  },
};

// ---------------------------------------------------------------------------
// Guarded media URLs. The routes stream bytes with cookie auth; these return
// the same-origin path for an <img src>, never a public/long-lived URL.
// ---------------------------------------------------------------------------

/** Same-origin path for a private evidence image/file (GET /api/evidence/:id). */
export function evidenceMediaUrl(evidenceId: string): string {
  return `/api/evidence/${evidenceId}`;
}

/** Same-origin path for a reviewed publication asset (GET /api/publication-assets/:id). */
export function publicationAssetUrl(assetId: string): string {
  return `/api/publication-assets/${assetId}`;
}
