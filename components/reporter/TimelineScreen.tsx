"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { Channel, ReportDetail, ReportUpdate, Submission } from "@/lib/contracts";
import { api, evidenceMediaUrl } from "@/lib/client/api";
import { ROLE_LABEL } from "./EvidenceSection";
import {
  CloseDialog,
  FollowUpDialog,
  ResponseDialog,
  ResponseShareDialog,
  SubmissionDialog,
} from "./dialogs";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import { useReportDetail } from "./useReportDetail";
import {
  DemoDataNote,
  FailureNotice,
  LIFECYCLE_LABEL,
  Loading,
  PREPARATION_LABEL,
  REVISION_STATE_LABEL,
  VISIBILITY_LABEL,
  cx,
  formatDate,
  formatDateTime,
} from "./ui";
import styles from "./reporter.module.css";

/**
 * Private timeline — `/pilot/reports/:id` (docs/FOODPROOF_SCREENS.md §8, §9).
 *
 * Three status dimensions are shown separately and never merged into a progress
 * bar. Brand and official histories are kept apart, every external record is
 * labelled as reporter-recorded, and closure is worded as the reporter stopping
 * — never as resolved, fixed or safe.
 */

const CHANNEL_TITLE: Record<Channel, string> = {
  brand: "Brand actions",
  government: "Official actions",
};

export function TimelineScreen({ reportId }: { reportId: string }) {
  const { detail, status, failure, reload, apply } = useReportDetail(reportId);
  const { keyFor, settled } = useIdempotencyKeys();
  const [dialog, setDialog] = useState<
    | { kind: "submission"; channel: Channel }
    | { kind: "response"; submission: Submission }
    | { kind: "follow_up"; submission: Submission }
    | { kind: "share_response"; update: ReportUpdate }
    | { kind: "close" }
    | null
  >(null);
  const [actionFailure, setActionFailure] = useState<Failure | null>(null);
  const [reopening, setReopening] = useState(false);

  const updatesBySubmission = useMemo(() => {
    const map = new Map<string, ReportUpdate[]>();
    for (const update of detail?.updates ?? []) {
      if (!update.submission_id) continue;
      const list = map.get(update.submission_id) ?? [];
      list.push(update);
      map.set(update.submission_id, list);
    }
    return map;
  }, [detail?.updates]);

  const internalUpdates = useMemo(
    () => (detail?.updates ?? []).filter((update) => !update.submission_id),
    [detail?.updates],
  );

  const reopen = useCallback(async () => {
    if (!detail) return;
    setReopening(true);
    setActionFailure(null);
    const key = keyFor("report.reopen", { reportId: detail.report_id, version: detail.version });
    try {
      const next = await api.reports.reopen(detail.report_id, key);
      settled("report.reopen");
      apply(next);
    } catch (error) {
      const next = toFailure(error);
      setActionFailure(next);
      trackFlowError("save", next);
    } finally {
      setReopening(false);
    }
  }, [apply, detail, keyFor, settled]);

  if (status === "loading") {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Your report</h1>
        <Loading what="this report" />
      </section>
    );
  }

  if (status === "failed" || !detail) {
    return (
      <section className={styles.screen}>
        <h1 className={styles.title}>Your report</h1>
        {failure ? <FailureNotice failure={failure} onRetry={() => void reload()} /> : null}
        <div className={styles.actions}>
          <Link className={styles.btnSecondary} href="/pilot/reports">
            Back to my reports
          </Link>
        </div>
      </section>
    );
  }

  const concernRequests = detail.review_requests.filter(
    (request) => request.content_kind === "concern",
  );
  const responseRequests = detail.review_requests.filter(
    (request) => request.content_kind === "response",
  );
  const latestConcernRequest = concernRequests[0];

  return (
    <section className={styles.screen} aria-labelledby="timeline-title">
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="timeline-title">
            {detail.product_name}
            {detail.variant ? ` · ${detail.variant}` : ""}
          </h1>
          <p className={styles.lede}>{detail.brand}</p>
        </div>
        <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}/edit`}>
          Edit report
        </Link>
      </div>

      <DemoDataNote />

      <dl className={styles.statusStrip}>
        <div className={styles.statusCell}>
          <dt>Preparation</dt>
          <dd>{PREPARATION_LABEL[detail.preparation]}</dd>
        </div>
        <div className={styles.statusCell}>
          <dt>Community visibility</dt>
          <dd>{VISIBILITY_LABEL[detail.community_visibility]}</dd>
        </div>
        <div className={styles.statusCell}>
          <dt>Personal follow-up</dt>
          <dd>{LIFECYCLE_LABEL[detail.lifecycle]}</dd>
        </div>
      </dl>

      {actionFailure ? <FailureNotice failure={actionFailure} /> : null}

      <div className={styles.actions}>
        <Link className="btn-primary" href={`/pilot/reports/${detail.report_id}/actions`}>
          Prepare a complaint
        </Link>
        <Link className={styles.btnSecondary} href={`/pilot/reports/${detail.report_id}/share`}>
          {detail.community_visibility === "private"
            ? "Preview community version"
            : "Manage community sharing"}
        </Link>
        {detail.community_visibility === "published" ? (
          <Link className={styles.btnQuiet} href={`/pilot/concerns/${detail.report_id}`}>
            See the community version
          </Link>
        ) : null}
      </div>

      <section className={styles.section} aria-labelledby="summary-title">
        <h2 className={styles.sectionTitle} id="summary-title">
          What you recorded
        </h2>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>Brand</dt>
            <dd>{detail.brand}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Observed on</dt>
            <dd>{formatDate(detail.observation_date)}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Batch number</dt>
            <dd>{detail.batch_number ?? "Not supplied"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Concern</dt>
            <dd className={styles.pre}>{detail.concern_text ?? "Not written yet"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Label claim</dt>
            <dd className={styles.pre}>{detail.claim_text ?? "Not supplied"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Ingredients</dt>
            <dd className={styles.pre}>{detail.ingredients_text ?? "Not supplied"}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>Facts confirmed</dt>
            <dd>
              {detail.facts_confirmed_at
                ? `By you on ${formatDateTime(detail.facts_confirmed_at)}`
                : "Not confirmed yet"}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="evidence-title">
        <h2 className={styles.sectionTitle} id="evidence-title">
          Evidence ({detail.evidence.length})
        </h2>
        {detail.evidence.length === 0 ? (
          <p className={styles.small}>No files yet. Add label photos from the editor.</p>
        ) : (
          <ul className={styles.evidenceGrid}>
            {detail.evidence.map((item) => (
              <li className={styles.evidenceCard} key={item.id}>
                {item.mime_type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- guarded, cookie-authenticated media route.
                  <img
                    className={styles.thumb}
                    src={evidenceMediaUrl(item.id)}
                    alt={
                      item.roles.length
                        ? `Label photo showing: ${item.roles.map((role) => ROLE_LABEL[role]).join(", ")}`
                        : `Stored ${item.kind} image`
                    }
                  />
                ) : (
                  <p className={styles.small}>{item.mime_type} file (not an image)</p>
                )}
                <p className={styles.small}>
                  {item.kind === "label" ? "Label photo" : null}
                  {item.kind === "receipt" ? "Purchase receipt" : null}
                  {item.kind === "acknowledgement" ? "Acknowledgement" : null}
                  {item.kind === "response" ? "Response attachment" : null}
                  {item.roles.length
                    ? ` · ${item.roles.map((role) => ROLE_LABEL[role]).join(", ")}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.footnote}>
          These originals stay private. Only images you explicitly select and the
          owner approves ever get a community copy.
        </p>
      </section>

      {(["brand", "government"] as const).map((channel) => {
        const submissions = detail.submissions.filter((item) => item.channel === channel);
        return (
          <section className={styles.section} key={channel} aria-labelledby={`${channel}-title`}>
            <div className={cx(styles.actions, styles.spread)}>
              <h2 className={styles.sectionTitle} id={`${channel}-title`}>
                {CHANNEL_TITLE[channel]}
              </h2>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDialog({ kind: "submission", channel })}
              >
                Record a submission
              </button>
            </div>
            {submissions.length === 0 ? (
              <p className={styles.small}>
                No submission recorded. That means you have not recorded one here —
                it does not say anything about what {channel === "brand" ? "a brand" : "an authority"} has
                or has not done.
              </p>
            ) : (
              <ul className={styles.rows}>
                {submissions.map((submission) => {
                  const related = updatesBySubmission.get(submission.id) ?? [];
                  return (
                    <li className={styles.row} key={submission.id}>
                      <div className={styles.rowMain}>
                        <h3 className={styles.rowTitle}>{submission.recipient}</h3>
                        <p className={styles.small}>
                          Submission recorded by reporter · sent{" "}
                          {formatDate(submission.submitted_at)}
                          {submission.reference ? ` · reference ${submission.reference}` : ""}
                        </p>
                        <p className={styles.small}>
                          {submission.has_acknowledgement
                            ? "Acknowledgement file attached by the reporter (not independent confirmation)."
                            : "No acknowledgement file attached."}
                        </p>
                        {related.length > 0 ? (
                          <ul className={styles.timeline}>
                            {related.map((update) => (
                              <li className={styles.timelineItem} key={update.id}>
                                <span className={styles.timelineWhere}>
                                  {update.kind === "response"
                                    ? "Response recorded by reporter"
                                    : "Follow-up recorded by reporter"}
                                </span>
                                <p className={styles.pre}>
                                  {update.sender ? `${update.sender} · ` : ""}
                                  {formatDate(update.occurred_at)}
                                </p>
                                <p className={styles.pre}>{update.summary}</p>
                                <p className={styles.small}>
                                  {update.has_attachment
                                    ? "Supporting attachment provided by the reporter."
                                    : "No attachment."}{" "}
                                  Private unless separately shared.
                                </p>
                                {update.kind === "response" ? (
                                  <button
                                    type="button"
                                    className={styles.btnQuiet}
                                    onClick={() => setDialog({ kind: "share_response", update })}
                                  >
                                    Preview response for sharing
                                  </button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.small}>No response recorded.</p>
                        )}
                      </div>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => setDialog({ kind: "response", submission })}
                        >
                          Add a response
                        </button>
                        <button
                          type="button"
                          className={styles.btnQuiet}
                          onClick={() => setDialog({ kind: "follow_up", submission })}
                        >
                          Record follow-up
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <section className={styles.section} aria-labelledby="internal-title">
        <h2 className={styles.sectionTitle} id="internal-title">
          Inside FoodProof
        </h2>
        <ul className={styles.timeline}>
          <li className={styles.timelineItem}>
            <span className={styles.timelineWhere}>Inside FoodProof</span>
            <p>Private report created · {formatDateTime(detail.created_at)}</p>
          </li>
          <li className={styles.timelineItem}>
            <span className={styles.timelineWhere}>Inside FoodProof</span>
            <p>Last saved · {formatDateTime(detail.updated_at)}</p>
          </li>
          {concernRequests.map((request) => (
            <li className={styles.timelineItem} key={request.publication_revision_id}>
              <span className={styles.timelineWhere}>Inside FoodProof</span>
              <p>
                Community review requested (revision {request.revision}) ·{" "}
                {formatDateTime(request.created_at)}
              </p>
              <p className={styles.small}>
                Now: {REVISION_STATE_LABEL[request.state]}
                {request.reason ? ` — owner’s reason: ${request.reason}` : ""}
              </p>
            </li>
          ))}
          {internalUpdates.map((update) => (
            <li className={styles.timelineItem} key={update.id}>
              <span className={styles.timelineWhere}>Inside FoodProof</span>
              <p>
                {update.kind === "closed" ? "Follow-up closed by reporter" : null}
                {update.kind === "reopened" ? "Follow-up reopened by reporter" : null}
                {update.kind !== "closed" && update.kind !== "reopened" ? update.kind : null} ·{" "}
                {formatDate(update.occurred_at)}
              </p>
              <p className={styles.pre}>{update.summary}</p>
            </li>
          ))}
        </ul>
        {responseRequests.length > 0 ? (
          <>
            <h3 className={styles.subTitle}>Response review requests</h3>
            <ul className={styles.timeline}>
              {responseRequests.map((request) => {
                const source = detail.updates.find(
                  (u) => u.id === request.source_update_id,
                );
                return (
                  <li className={styles.timelineItem} key={request.publication_revision_id}>
                    <span className={styles.timelineWhere}>Inside FoodProof</span>
                    <p>
                      {source
                        ? `Response of ${formatDate(source.occurred_at)}${
                            source.sender ? ` from ${source.sender}` : ""
                          }`
                        : "Response"}{" "}
                      sent for owner review · {formatDateTime(request.created_at)} · now{" "}
                      {REVISION_STATE_LABEL[request.state]}
                      {request.reason ? ` — owner’s reason: ${request.reason}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {latestConcernRequest ? (
          <p className={styles.small}>
            Publication events are internal to FoodProof. They are not a
            government filing and they say nothing about product safety.
          </p>
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="followup-title">
        <h2 className={styles.sectionTitle} id="followup-title">
          Personal follow-up
        </h2>
        {detail.lifecycle === "closed_by_reporter" ? (
          <>
            <p>
              You closed your follow-up
              {detail.close_reason ? `: ${detail.close_reason}` : "."}
            </p>
            <p className={styles.small}>
              Closed by reporter. This does not mean the concern was resolved, the
              label was corrected, or the product is safe. Any published community
              version is unaffected.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => void reopen()}
                disabled={reopening}
              >
                {reopening ? "Reopening…" : "Reopen my follow-up"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.small}>
              Your follow-up is open. Closing it records that you stopped pursuing
              this yourself; it never establishes safety and never withdraws a
              community version.
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setDialog({ kind: "close" })}
              >
                Close my follow-up
              </button>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === "submission" ? (
        <SubmissionDialog
          report={detail}
          channel={dialog.channel}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      ) : null}
      {dialog?.kind === "response" ? (
        <ResponseDialog
          report={detail}
          submission={dialog.submission}
          onClose={() => setDialog(null)}
          onSaved={reload}
          onShareResponse={(update) => setDialog({ kind: "share_response", update })}
        />
      ) : null}
      {dialog?.kind === "follow_up" ? (
        <FollowUpDialog
          report={detail}
          submission={dialog.submission}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      ) : null}
      {dialog?.kind === "share_response" ? (
        <ResponseShareDialog
          report={detail}
          update={dialog.update}
          onClose={() => setDialog(null)}
          onSaved={reload}
        />
      ) : null}
      {dialog?.kind === "close" ? (
        <CloseDialog report={detail} onClose={() => setDialog(null)} onSaved={apply} />
      ) : null}
    </section>
  );
}
