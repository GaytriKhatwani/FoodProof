"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductMatch } from "@/lib/client/api";
import type { ReportDetail, ReportWriteRequest } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import { EvidenceSection } from "./EvidenceSection";
import { ReadinessPanel } from "./ReadinessPanel";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import {
  DemoDataNote,
  FailureNotice,
  Loading,
  SaveState,
  StatusChips,
  TextAreaField,
  TextField,
  cx,
  formatDateTime,
  todayIso,
} from "./ui";
import styles from "./reporter.module.css";

/**
 * Guided report editor — `/pilot/reports/new` and `/pilot/reports/:id/edit`
 * (docs/FOODPROOF_SCREENS.md §5). Four revisitable steps; an incomplete private
 * draft can be saved at any time. Saving is private: it publishes nothing and
 * contacts nobody. Every failed save keeps the typed values on screen, and a
 * retry reuses the same Idempotency-Key so a request that did reach the server
 * is replayed rather than duplicated.
 */

const STEPS = ["Product", "Evidence", "Concern", "Review"] as const;

interface EditorForm {
  product_name: string;
  brand: string;
  variant: string;
  observation_date: string;
  batch_number: string;
  concern_text: string;
  claim_text: string;
  ingredients_text: string;
  product_id: string | null;
}

const EMPTY_FORM: EditorForm = {
  product_name: "",
  brand: "",
  variant: "",
  observation_date: "",
  batch_number: "",
  concern_text: "",
  claim_text: "",
  ingredients_text: "",
  product_id: null,
};

function formFrom(detail: ReportDetail): EditorForm {
  return {
    product_name: detail.product_name,
    brand: detail.brand,
    variant: detail.variant ?? "",
    observation_date: detail.observation_date ?? "",
    batch_number: detail.batch_number ?? "",
    concern_text: detail.concern_text ?? "",
    claim_text: detail.claim_text ?? "",
    ingredients_text: detail.ingredients_text ?? "",
    product_id: detail.product_id,
  };
}

const blankToNull = (value: string): string | null => (value.trim() ? value.trim() : null);

function writeRequest(form: EditorForm, expectedVersion: number | null): ReportWriteRequest {
  return {
    product_name: form.product_name.trim(),
    brand: form.brand.trim(),
    variant: blankToNull(form.variant),
    observation_date: blankToNull(form.observation_date),
    batch_number: blankToNull(form.batch_number),
    concern_text: blankToNull(form.concern_text),
    claim_text: blankToNull(form.claim_text),
    ingredients_text: blankToNull(form.ingredients_text),
    product_id: form.product_id,
    expected_version: expectedVersion,
  };
}

export function ReportEditorScreen({
  reportId: initialReportId,
  fromConcernId,
  source,
}: {
  reportId: string | null;
  fromConcernId: string | null;
  source: "feed" | "detail" | "my_reports";
}) {
  const router = useRouter();
  const { keyFor, settled } = useIdempotencyKeys();

  const idRef = useRef<string | null>(initialReportId);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "failed">(
    initialReportId ? "loading" : "ready",
  );
  const [loadFailure, setLoadFailure] = useState<Failure | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveFailure, setSaveFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [prefillNote, setPrefillNote] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<Failure | null>(null);
  const startedRef = useRef(false);

  const initialisedRef = useRef(false);

  /**
   * Read the saved report. The form is populated from the FIRST successful
   * load only: a later response (React strict-mode's double effect, a retry, or
   * a slow duplicate) must never overwrite text the reporter has already typed.
   */
  const loadDetail = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    setLoadStatus((previous) => (previous === "ready" ? previous : "loading"));
    try {
      const result = await api.reports.get(id);
      setDetail(result);
      if (!initialisedRef.current) {
        initialisedRef.current = true;
        setForm(formFrom(result));
      }
      setLoadFailure(null);
      setLoadStatus("ready");
    } catch (error) {
      const failure = toFailure(error);
      setLoadFailure(failure);
      setLoadStatus("failed");
      trackFlowError("load", failure);
    }
  }, []);

  /**
   * Re-read the report without touching the editor's typed values. `announce`
   * is used by the stale-version recovery: it reports the outcome and, while it
   * is in flight, saving is blocked — otherwise a save fired mid-reload would
   * still carry the old `expected_version` and fail again.
   */
  const refreshDetailOnly = useCallback(async (announce = false) => {
    const id = idRef.current;
    if (!id) return;
    setRefreshing(true);
    if (announce) setRefreshNote(null);
    try {
      const result = await api.reports.get(id);
      setDetail(result);
      setLoadFailure(null);
      if (announce) {
        setSaveFailure(null);
        setSaveState("idle");
        setRefreshNote(
          "Reloaded the saved version. Everything you typed is still below — check it, then save again.",
        );
      }
    } catch (error) {
      const failure = toFailure(error);
      setLoadFailure(failure);
      if (announce) {
        setRefreshNote(null);
        setSaveFailure(failure);
      }
      trackFlowError("load", failure);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (initialReportId) void loadDetail();
  }, [initialReportId, loadDetail]);

  // From-concern prefill: identity fields ONLY. Requirement R09 — an independent
  // report keeps its own evidence and history, and nothing is merged.
  useEffect(() => {
    if (initialReportId || !fromConcernId) return;
    let cancelled = false;
    void (async () => {
      try {
        const concern = await api.feed.get(fromConcernId);
        if (cancelled) return;
        setForm((current) => ({
          ...current,
          brand: concern.brand,
          product_name: concern.product_name,
          variant: concern.variant ?? "",
          product_id: concern.product_id,
        }));
        setPrefillNote(
          "Product identity was copied from a community concern. This report is independent: none of that report's evidence, text or history is copied here.",
        );
      } catch {
        if (cancelled) return;
        setPrefillNote(
          "That community concern could not be loaded, so nothing was prefilled. You can still enter the product details yourself.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromConcernId, initialReportId]);

  // `report_started` fires once when a NEW editable report screen is shown after
  // an explicit create action; resumed drafts are excluded by design.
  useEffect(() => {
    if (initialReportId || startedRef.current) return;
    if (fromConcernId && !prefillNote) return;
    startedRef.current = true;
    clientAnalytics.track("report_started", {
      flow_id: crypto.randomUUID(),
      source,
      linked_product: Boolean(fromConcernId),
    });
  }, [fromConcernId, initialReportId, prefillNote, source]);

  const dirty = useMemo(() => {
    if (!detail) {
      return Object.entries(form).some(([key, value]) =>
        key === "product_id" ? value !== null : String(value).trim() !== "",
      );
    }
    const saved = formFrom(detail);
    return (Object.keys(saved) as (keyof EditorForm)[]).some(
      (key) => (form[key] ?? "") !== (saved[key] ?? ""),
    );
  }, [detail, form]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const update = useCallback((patch: Partial<EditorForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaveState("idle");
  }, []);

  const validate = useCallback((): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.product_name.trim()) errors.product_name = "Enter the product name.";
    if (!form.brand.trim()) errors.brand = "Enter the brand.";
    if (form.observation_date && form.observation_date > todayIso()) {
      errors.observation_date = "The observation date cannot be in the future.";
    }
    return errors;
  }, [form]);

  const save = useCallback(
    async (then: "stay" | "open-record") => {
      const errors = validate();
      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setSaveState("failed");
        setSaveFailure({
          kind: "validation",
          message:
            "A product name and brand are needed before this private draft can be saved. Everything else can stay incomplete.",
          retryAfterSeconds: null,
        });
        setStep(0);
        return;
      }
      setFieldErrors({});
      setSaveState("saving");
      setSaveFailure(null);
      const body = writeRequest(form, detail?.version ?? null);
      const key = keyFor("report.save", body);
      try {
        const saved = detail
          ? await api.reports.patch(detail.report_id, body, key)
          : await api.reports.create(body, key);
        settled("report.save");
        const isFirstSave = !detail;
        idRef.current = saved.report_id;
        initialisedRef.current = true;
        setDetail(saved);
        setForm(formFrom(saved));
        setSaveState("saved");
        if (isFirstSave) {
          // Keep the browser URL in step with the saved draft so a reload
          // resumes it instead of opening an empty editor.
          try {
            window.history.replaceState(null, "", `/pilot/reports/${saved.report_id}/edit`);
          } catch {
            /* URL cosmetics only; the draft is already saved. */
          }
        }
        if (then === "open-record") router.push(`/pilot/reports/${saved.report_id}`);
      } catch (error) {
        const failure = toFailure(error);
        setSaveState("failed");
        setSaveFailure(failure);
        if (failure.fields) setFieldErrors(failure.fields);
        trackFlowError("save", failure);
      }
    },
    [detail, form, keyFor, router, settled, validate],
  );

  const confirmFacts = useCallback(async () => {
    if (!detail) return;
    setConfirming(true);
    setConfirmFailure(null);
    const body = {
      expected_version: detail.version,
      claim_text: blankToNull(form.claim_text),
      ingredients_text: blankToNull(form.ingredients_text),
      method: "manual" as const,
    };
    const key = keyFor("report.confirm-facts", body);
    try {
      const saved = await api.reports.confirmFacts(detail.report_id, body, key);
      settled("report.confirm-facts");
      setDetail(saved);
      setForm(formFrom(saved));
    } catch (error) {
      const failure = toFailure(error);
      setConfirmFailure(failure);
      trackFlowError("save", failure);
    } finally {
      setConfirming(false);
    }
  }, [detail, form.claim_text, form.ingredients_text, keyFor, settled]);

  const factsChangedSinceConfirmation =
    detail !== null &&
    (blankToNull(form.claim_text) !== detail.claim_text ||
      blankToNull(form.ingredients_text) !== detail.ingredients_text);

  if (loadStatus === "loading") {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Edit report</h1>
        <Loading what="this report" />
      </section>
    );
  }

  if (loadStatus === "failed" && loadFailure) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Edit report</h1>
        <FailureNotice failure={loadFailure} onRetry={() => void loadDetail()} />
        <p className={styles.actions}>
          <Link className={styles.btnSecondary} href="/pilot/reports">
            Back to my reports
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby="editor-title">
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="editor-title">
            {detail ? "Edit your report" : "Raise a concern"}
          </h1>
          <p className={styles.lede}>
            A private record of what you saw. Saving keeps it to yourself —
            sharing with the community and sending a complaint are separate steps
            you take later.
          </p>
        </div>
        {detail ? (
          <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}`}>
            Open the record
          </Link>
        ) : null}
      </div>

      <DemoDataNote />
      {prefillNote ? <p className={styles.inset}>{prefillNote}</p> : null}

      {detail ? (
        <StatusChips
          preparation={detail.preparation}
          visibility={detail.community_visibility}
          lifecycle={detail.lifecycle}
        />
      ) : null}

      <ol className={styles.steps}>
        {STEPS.map((name, index) => (
          <li key={name}>
            <button
              type="button"
              className={styles.stepButton}
              aria-current={step === index ? "step" : undefined}
              onClick={() => setStep(index)}
            >
              <span className={styles.stepNum}>{index + 1}</span>
              {name}
            </button>
          </li>
        ))}
      </ol>

      <div className={styles.section}>
        {step === 0 ? (
          <ProductStep
            form={form}
            fieldErrors={fieldErrors}
            onChange={update}
            onLink={(match) =>
              update({
                product_id: match.product_id,
                brand: match.brand,
                product_name: match.name,
                variant: match.variant ?? form.variant,
              })
            }
            onUnlink={() => update({ product_id: null })}
          />
        ) : null}

        {step === 1 ? (
          detail ? (
            <EvidenceSection report={detail} onChanged={() => refreshDetailOnly()} />
          ) : (
            <div>
              <h2 className={styles.sectionTitle}>Evidence</h2>
              <p className={styles.inset}>
                Files attach to a saved report. Save this private draft first —
                you only need a product name and brand — then add your label
                photos here.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void save("stay")}
                  disabled={saveState === "saving" || refreshing}
                >
                  Save private draft
                </button>
              </div>
            </div>
          )
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className={styles.sectionTitle}>What doesn’t add up?</h2>
            <p className={styles.small}>
              Describe what you can see on the label. You do not need to make a
              legal claim, and FoodProof does not decide whether a product is
              safe.
            </p>
            <TextAreaField
              id="concern-text"
              label="Your concern"
              rows={5}
              value={form.concern_text}
              hint="Required before you can request a community review."
              onChange={(value) => update({ concern_text: value })}
            />

            <h3 className={styles.subTitle}>Label facts</h3>
            <p className={styles.small}>
              Type these exactly as they appear on your photo. Automatic text
              extraction is not part of this build, so every fact here is entered
              and confirmed by you.
            </p>
            <TextField
              id="claim-text"
              label="Gluten-free wording on the label"
              value={form.claim_text}
              onChange={(value) => update({ claim_text: value })}
            />
            <TextAreaField
              id="ingredients-text"
              label="Ingredient wording"
              rows={3}
              value={form.ingredients_text}
              onChange={(value) => update({ ingredients_text: value })}
            />

            {detail ? (
              <div className={styles.panel}>
                <h3 className={styles.subTitle}>Confirm these facts</h3>
                {detail.facts_confirmed_at && !factsChangedSinceConfirmation ? (
                  <p>
                    You confirmed this wording on{" "}
                    {formatDateTime(detail.facts_confirmed_at)}.
                  </p>
                ) : null}
                {detail.facts_confirmed_at && factsChangedSinceConfirmation ? (
                  <p className={styles.fieldError}>
                    You changed the wording since you confirmed it. Confirm again,
                    or the saved report goes back to unconfirmed.
                  </p>
                ) : null}
                {!detail.facts_confirmed_at ? (
                  <p>
                    Not confirmed yet. Confirming saves this wording and records
                    that you checked it against your own photo.
                  </p>
                ) : null}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void confirmFacts()}
                    disabled={confirming || refreshing}
                  >
                    {confirming ? "Saving…" : "I checked this wording against my photo"}
                  </button>
                </div>
                {confirmFailure ? (
                  <FailureNotice
                    failure={confirmFailure}
                    onRetry={() => void confirmFacts()}
                    onReload={
                      confirmFailure.kind === "stale" ? () => void refreshDetailOnly(true) : undefined
                    }
                  />
                ) : null}
              </div>
            ) : (
              <p className={styles.inset}>
                Save the private draft first — confirmation is recorded against
                the saved report.
              </p>
            )}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <h2 className={styles.sectionTitle}>Keep the facts together</h2>
            <dl className={styles.defs}>
              <div className={styles.defRow}>
                <dt>Product</dt>
                <dd>{form.product_name || "Not entered"}</dd>
              </div>
              <div className={styles.defRow}>
                <dt>Brand</dt>
                <dd>{form.brand || "Not entered"}</dd>
              </div>
              <div className={styles.defRow}>
                <dt>Variant</dt>
                <dd>{form.variant || "Not supplied"}</dd>
              </div>
              <div className={styles.defRow}>
                <dt>Observed on</dt>
                <dd>{form.observation_date || "Not supplied"}</dd>
              </div>
              <div className={styles.defRow}>
                <dt>Batch number</dt>
                <dd>{form.batch_number || "Not supplied"}</dd>
              </div>
              <div className={styles.defRow}>
                <dt>Concern</dt>
                <dd className={styles.pre}>{form.concern_text || "Not written yet"}</dd>
              </div>
            </dl>
            {detail ? (
              <ReadinessPanel report={detail} />
            ) : (
              <p className={styles.inset}>
                Nothing is saved yet. “Save report” stores this private draft; it
                does not publish anything or contact anyone.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className={cx(styles.actions, styles.spread)}>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
          >
            Back
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => void save("stay")}
            disabled={saveState === "saving" || refreshing}
          >
            Save private draft
          </button>
        </div>
        <div className={styles.actions}>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void save("open-record")}
              disabled={saveState === "saving" || refreshing}
            >
              Save report and open the record
            </button>
          )}
        </div>
      </div>

      <SaveState state={saveState} />
      {refreshing ? (
        <p className={styles.saveState} role="status" aria-live="polite">
          Reloading the saved version…
        </p>
      ) : null}
      {refreshNote ? (
        <p className={styles.okNote} role="status">
          {refreshNote}
        </p>
      ) : null}
      {dirty ? (
        <p className={styles.small}>
          Unsaved changes on this screen. They are not stored until a save
          succeeds.
        </p>
      ) : null}
      {saveFailure ? (
        <FailureNotice
          failure={saveFailure}
          onRetry={saveFailure.kind === "stale" ? undefined : () => void save("stay")}
          onReload={saveFailure.kind === "stale" ? () => void refreshDetailOnly(true) : undefined}
        />
      ) : null}

      <p className={styles.footnote}>
        Saving is private. It does not publish your report, does not send an
        email, and does not file a government complaint.
      </p>
    </section>
  );
}

/** Step 1 — product identity, plus optional linkage to an existing product. */
function ProductStep({
  form,
  fieldErrors,
  onChange,
  onLink,
  onUnlink,
}: {
  form: EditorForm;
  fieldErrors: Record<string, string>;
  onChange: (patch: Partial<EditorForm>) => void;
  onLink: (match: ProductMatch) => void;
  onUnlink: () => void;
}) {
  const [matches, setMatches] = useState<ProductMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [matchFailure, setMatchFailure] = useState<Failure | null>(null);

  const lookUp = useCallback(async () => {
    if (!form.brand.trim() || !form.product_name.trim()) {
      setMatchFailure({
        kind: "validation",
        message: "Enter a brand and product name before looking for an existing product.",
        retryAfterSeconds: null,
      });
      return;
    }
    setSearching(true);
    setMatchFailure(null);
    try {
      const result = await api.products.matches({
        brand: form.brand.trim(),
        name: form.product_name.trim(),
        variant: form.variant.trim() || undefined,
      });
      setMatches(result.matches);
    } catch (error) {
      setMatchFailure(toFailure(error));
    } finally {
      setSearching(false);
    }
  }, [form.brand, form.product_name, form.variant]);

  return (
    <div>
      <h2 className={styles.sectionTitle}>Start with the product</h2>
      <p className={styles.small}>
        Enough detail to recognise the label you saw. Use a sample or redacted
        product for this demo.
      </p>

      <TextField
        id="product-name"
        label="Product name"
        value={form.product_name}
        error={fieldErrors.product_name}
        onChange={(value) => onChange({ product_name: value })}
      />

      <TextField
        id="brand"
        label="Brand"
        value={form.brand}
        error={fieldErrors.brand}
        onChange={(value) => onChange({ brand: value })}
      />

      <div className={styles.grid2}>
        <TextField
          id="variant"
          label="Variant (optional)"
          value={form.variant}
          onChange={(value) => onChange({ variant: value })}
        />
        <TextField
          id="batch-number"
          label="Batch number (optional)"
          value={form.batch_number}
          onChange={(value) => onChange({ batch_number: value })}
        />
      </div>

      <TextField
        id="observation-date"
        label="Observation date (optional)"
        type="date"
        max={todayIso()}
        value={form.observation_date}
        error={fieldErrors.observation_date}
        onChange={(value) => onChange({ observation_date: value })}
      />

      <div className={styles.panel}>
        <h3 className={styles.subTitle}>Existing product record</h3>
        {form.product_id ? (
          <>
            <p className={styles.small}>
              This report is linked to a product record. Linking connects the
              identity only — your evidence, dates and history stay with this
              report.
            </p>
            <button type="button" className={styles.btnSecondary} onClick={onUnlink}>
              Remove the link (keep my typed identity)
            </button>
          </>
        ) : (
          <>
            <p className={styles.small}>
              Nothing is matched automatically. You can look for an existing
              product record and link this report to it yourself.
            </p>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => void lookUp()}
              disabled={searching}
            >
              {searching ? "Looking…" : "Look for an existing product"}
            </button>
          </>
        )}
        {matchFailure ? <FailureNotice failure={matchFailure} /> : null}
        {matches && matches.length === 0 ? (
          <p className={styles.small}>
            No existing product record matched. Your report will keep the identity
            you typed.
          </p>
        ) : null}
        {matches && matches.length > 0 ? (
          <ul className={styles.rows}>
            {matches.map((match) => (
              <li className={styles.row} key={match.product_id}>
                <div className={styles.rowMain}>
                  <p className={styles.pre}>
                    {match.brand} · {match.name}
                    {match.variant ? ` · ${match.variant}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => onLink(match)}
                >
                  Link this report’s identity
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className={styles.footnote}>
        Changing the identity here changes only your report. It never edits a
        shared product record or another person’s report.
      </p>
    </div>
  );
}
