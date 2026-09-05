"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReportDetail } from "@/lib/contracts";
import { api, evidenceMediaUrl } from "@/lib/client/api";
import { Modal } from "./Modal";
import { ROLE_LABEL, readyLabelEvidence } from "./EvidenceSection";
import { ReadinessPanel } from "./ReadinessPanel";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import { useReportDetail } from "./useReportDetail";
import {
  DemoDataNote,
  FailureNotice,
  Loading,
  REVISION_STATE_LABEL,
  VISIBILITY_LABEL,
  cx,
  formatDate,
  formatDateTime,
} from "./ui";
import styles from "./reporter.module.css";

/**
 * Community preview and consent — `/pilot/reports/:id/share`
 * (docs/FOODPROOF_SCREENS.md §6).
 *
 * This screen shows the exact snapshot that would go to the owner for review,
 * asks for explicit consent, and never calls anything "published" before the
 * server says so. Approval means approved for publication in this pilot — it is
 * not a safety finding, and it files nothing with any authority. Missing
 * evidence blocks the REQUEST only; private saving is always still allowed.
 */
export function ShareScreen({ reportId }: { reportId: string }) {
  const { detail, status, refreshing, failure, reload } = useReportDetail(reportId);
  const { keyFor, settled } = useIdempotencyKeys();
  const [selected, setSelected] = useState<string[] | null>(null);
  const [consent, setConsent] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [requestFailure, setRequestFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawFailure, setWithdrawFailure] = useState<Failure | null>(null);

  // Default the selection to every ready label photo, once, without ever
  // overriding a choice the reporter has already made.
  useEffect(() => {
    if (!detail || selected !== null) return;
    setSelected(readyLabelEvidence(detail).map((item) => item.id));
  }, [detail, selected]);

  const request = useCallback(async () => {
    if (!detail) return;
    const ids = selected ?? [];
    if (!consent) {
      setBlocked("Tick the consent box before sending this for review.");
      return;
    }
    if (ids.length === 0) {
      setBlocked("Select at least one label photo to include.");
      return;
    }
    setBlocked(null);
    setSending(true);
    setRequestFailure(null);
    const body = {
      expected_version: detail.version,
      consent: true as const,
      selected_evidence_ids: ids,
    };
    const key = keyFor("publication.concern", body);
    try {
      await api.publicationRequests.create(detail.report_id, body, key);
      settled("publication.concern");
      setSent(true);
      setConsent(false);
      await reload();
    } catch (error) {
      const next = toFailure(error);
      setRequestFailure(next);
      trackFlowError("publish", next);
    } finally {
      setSending(false);
    }
  }, [consent, detail, keyFor, reload, selected, settled]);

  const withdraw = useCallback(async () => {
    if (!detail) return;
    setWithdrawing(true);
    setWithdrawFailure(null);
    const key = keyFor("publication.withdraw", {
      reportId: detail.report_id,
      visibility: detail.community_visibility,
    });
    try {
      await api.reports.withdraw(detail.report_id, key);
      settled("publication.withdraw");
      setWithdrawOpen(false);
      setSent(false);
      await reload();
    } catch (error) {
      const next = toFailure(error);
      setWithdrawFailure(next);
      trackFlowError("publish", next);
    } finally {
      setWithdrawing(false);
    }
  }, [detail, keyFor, reload, settled]);

  if (status === "loading") {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Preview community version</h1>
        <Loading what="this report" />
      </section>
    );
  }

  if (status === "failed" || !detail) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Preview community version</h1>
        {failure ? <FailureNotice failure={failure} onRetry={() => void reload()} /> : null}
        <div className={styles.actions}>
          <Link className={styles.btnSecondary} href="/pilot/reports">
            Back to my reports
          </Link>
        </div>
      </section>
    );
  }

  const eligible = readyLabelEvidence(detail);
  const chosen = selected ?? [];
  const concernRequests = detail.review_requests.filter((r) => r.content_kind === "concern");
  const latest = concernRequests[0];
  const pending = detail.community_visibility === "pending_review";
  const published = detail.community_visibility === "published";
  const ready = detail.preparation === "ready";
  const canWithdraw = published || pending;

  return (
    <section className={styles.screen} aria-labelledby="share-title">
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="share-title">
            Preview community version
          </h1>
          <p className={styles.lede}>
            Only what is shown below would be proposed for sharing inside this
            pilot. Requesting a review sends nothing to a brand or an authority.
          </p>
        </div>
        <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}`}>
          Back to the record
        </Link>
      </div>

      <DemoDataNote />

      <p className={styles.inset}>
        Community status: <strong>{VISIBILITY_LABEL[detail.community_visibility]}</strong>.
        {published
          ? " Approved means the owner approved this version for publication in the pilot. It is not a safety check and it does not verify the product."
          : " Nothing is visible to the community until the owner approves it."}
      </p>

      {latest ? (
        <div className={styles.panel}>
          <h2 className={styles.subTitle}>Your last review request</h2>
          <p>
            Revision {latest.revision} · {REVISION_STATE_LABEL[latest.state]} · requested{" "}
            {formatDateTime(latest.created_at)}
          </p>
          {latest.reason ? (
            <p className={styles.pre}>Owner’s reason: {latest.reason}</p>
          ) : null}
          {latest.state === "changes_requested" || latest.state === "rejected" ? (
            <div className={styles.actions}>
              <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}/edit`}>
                Edit the report, then request a new review
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {sent ? (
        <p className={styles.okNote} role="status">
          Sent for owner review. Nothing is published yet, and nothing was sent
          outside FoodProof.
        </p>
      ) : null}

      {!ready ? (
        <>
          <p className={styles.alert} role="alert">
            This report is not ready to be proposed for review yet. Your private
            record is unaffected — you can keep saving it while it is incomplete.
          </p>
          <ReadinessPanel report={detail} editHref={`/pilot/reports/${detail.report_id}/edit`} />
        </>
      ) : null}

      <section className={styles.section} aria-labelledby="preview-title">
        <h2 className={styles.sectionTitle} id="preview-title">
          What would be reviewed
        </h2>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>Product</dt>
            <dd>
              {detail.product_name}
              {detail.variant ? ` · ${detail.variant}` : ""}
            </dd>
          </div>
          <div className={styles.defRow}>
            <dt>Brand</dt>
            <dd>{detail.brand}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Contributor</dt>
            <dd>Anonymous contributor</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Observed on</dt>
            <dd>{formatDate(detail.observation_date)}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Concern</dt>
            <dd className={styles.pre}>{detail.concern_text ?? "Not written yet"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Label claim you confirmed</dt>
            <dd className={styles.pre}>{detail.claim_text ?? "Not supplied"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Ingredients you confirmed</dt>
            <dd className={styles.pre}>{detail.ingredients_text ?? "Not supplied"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Recorded actions</dt>
            <dd>
              Whether you recorded a brand or official submission is included, per
              channel. Recipients, references and correspondence are not.
            </dd>
          </div>
        </dl>
        <p className={styles.small}>
          Not included: your account label, receipts, batch number, private
          correspondence, attachments you have not selected, and your closure
          reason.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="assets-title">
        <h2 className={styles.sectionTitle} id="assets-title">
          Label photos to include
        </h2>
        {eligible.length === 0 ? (
          <p className={styles.small}>
            No stored label photo yet. Add one in the editor before requesting a
            review.
          </p>
        ) : (
          <ul className={styles.evidenceGrid}>
            {eligible.map((item) => (
              <li className={styles.evidenceCard} key={item.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- guarded, cookie-authenticated media route. */}
                <img
                  className={styles.thumb}
                  src={evidenceMediaUrl(item.id)}
                  alt={
                    item.roles.length
                      ? `Label photo showing: ${item.roles.map((role) => ROLE_LABEL[role]).join(", ")}`
                      : "Label photo with no role assigned"
                  }
                />
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={pending}
                    checked={chosen.includes(item.id)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const list = current ?? [];
                        return event.target.checked
                          ? [...list, item.id]
                          : list.filter((id) => id !== item.id);
                      })
                    }
                  />
                  <span>
                    Include this photo
                    {item.roles.length
                      ? ` (${item.roles.map((role) => ROLE_LABEL[role]).join(", ")})`
                      : " (no role assigned)"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.footnote}>
          A reviewed copy is made of each photo you select. Redaction is not
          automatic: if a photo shows something private, replace it in the editor
          with a redacted version before requesting a review.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="consent-title">
        <h2 className={styles.sectionTitle} id="consent-title">
          Your consent
        </h2>
        {pending ? (
          <p className={styles.inset}>
            This version is already with the owner for review. Withdraw it first if
            you want to change what you proposed.
          </p>
        ) : null}
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={consent}
            disabled={pending}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            I want this version and the photos I selected shared with the pilot
            community after the owner reviews them.
          </span>
        </label>

        {blocked ? (
          <p className={styles.alert} role="alert">
            {blocked}
          </p>
        ) : null}
        {refreshing ? (
          <p className={styles.saveState} role="status" aria-live="polite">
            Reloading the saved version…
          </p>
        ) : null}
        {requestFailure ? (
          <FailureNotice
            failure={requestFailure}
            onRetry={requestFailure.kind === "stale" ? undefined : () => void request()}
            onReload={requestFailure.kind === "stale" ? () => void reload() : undefined}
          />
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void request()}
            disabled={sending || refreshing || pending || !ready}
          >
            {sending
              ? "Sending…"
              : published
                ? "Request review of these changes"
                : "Request publication review"}
          </button>
          <Link className={styles.btnQuiet} href={`/pilot/reports/${detail.report_id}`}>
            Keep this private
          </Link>
        </div>
        <p className={styles.footnote}>
          This creates a review request inside FoodProof. It does not send an
          email, does not file a government complaint, and does not establish
          that a product is unsafe.
        </p>
      </section>

      {canWithdraw ? (
        <section className={styles.section} aria-labelledby="withdraw-title">
          <h2 className={styles.sectionTitle} id="withdraw-title">
            Withdraw community sharing
          </h2>
          <p className={styles.small}>
            {published
              ? "Withdrawing hides the community version immediately. Your private record, evidence and history stay exactly as they are."
              : "Withdrawing cancels the request waiting with the owner. Your private record is unaffected."}
          </p>
          {withdrawFailure ? <FailureNotice failure={withdrawFailure} /> : null}
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => setWithdrawOpen(true)}
            >
              Withdraw community sharing
            </button>
          </div>
        </section>
      ) : null}

      {withdrawOpen ? (
        <Modal title="Withdraw community sharing?" onClose={() => setWithdrawOpen(false)}>
          <p>
            {published
              ? "The community version stops being visible straight away, and any approved response summaries go with it."
              : "The review request waiting with the owner is cancelled."}
          </p>
          <p className={styles.small}>
            Your private report, its evidence and its history are preserved. You
            can request a review again later.
          </p>
          {withdrawFailure ? (
            <FailureNotice failure={withdrawFailure} onRetry={() => void withdraw()} />
          ) : null}
          <div className={cx(styles.actions, styles.spread)}>
            <button
              type="button"
              className={styles.btnQuiet}
              onClick={() => setWithdrawOpen(false)}
              disabled={withdrawing}
            >
              Keep it shared
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => void withdraw()}
              disabled={withdrawing}
            >
              {withdrawing ? "Withdrawing…" : "Yes, withdraw it"}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
