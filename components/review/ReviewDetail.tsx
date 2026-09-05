"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { api, publicationAssetUrl, type ReviewDetailResponse } from "@/lib/client/api";
import type { DecisionAction, PublicReport } from "@/lib/contracts";
import { failureKind, loadFailureCopy } from "@/components/shell/errors";
import { formatDateOr, productTitle } from "@/components/shell/format";
import { InlineNote, LoadingBlock, StateBlock } from "@/components/shell/states";
import { useActionKey } from "@/components/shell/useActionKey";
import { EvidenceViewer } from "@/components/community/EvidenceViewer";
import { ModerationActions } from "./ModerationActions";
import { SnapshotView } from "./SnapshotView";
import styles from "./ReviewDetail.module.css";

/**
 * Reviewer detail — `/pilot/review/:requestId`
 * (docs/FOODPROOF_SCREENS.md §10).
 *
 * Shows exactly the frozen snapshot that would be published and the frozen
 * assets attached to it — never anything re-read from the live report, so a
 * reporter's later edit cannot change what a reviewer approves. Approve
 * requires both checklists; requesting changes and rejecting require a reason.
 * A 409 means the request moved under the reviewer, and the only offered path
 * is to reload it.
 */

const EVIDENCE_CHECKS = [
  { key: "identity", label: "Product identity is visible in the evidence" },
  { key: "claim", label: "The claim being questioned is visible in the evidence" },
  { key: "ingredients", label: "The ingredient list is visible in the evidence" },
  { key: "explanation", label: "The written concern explains what the evidence shows" },
] as const;

const PRIVACY_CHECKS = [
  { key: "personal", label: "No personal or contact information is exposed" },
  { key: "wording", label: "The wording states what was observed and claims no safety verdict" },
] as const;

type CheckKey = (typeof EVIDENCE_CHECKS)[number]["key"] | (typeof PRIVACY_CHECKS)[number]["key"];

const DECIDED_STATE_COPY: Record<string, { title: string; body: string }> = {
  approved: {
    title: "This request is already approved",
    body: "The snapshot below is the version that was published. Approving again is not possible; use the moderation actions if it should no longer be visible.",
  },
  changes_requested: {
    title: "Changes were already requested",
    body: "The reporter has been asked to revise this. A revised version arrives in the queue as a new request.",
  },
  rejected: {
    title: "This request was already rejected",
    body: "Nothing from it is published. The reporter keeps their private record.",
  },
  withdrawn: {
    title: "The reporter withdrew this request",
    body: "Withdrawal cancels anything still awaiting approval, so there is no decision left to take.",
  },
  removed: {
    title: "This content was removed from the community",
    body: "Removal hid the published version and cancelled anything still awaiting approval. The private record is kept.",
  },
  pending_review: { title: "", body: "" },
};

export function ReviewDetail({ revisionId }: { revisionId: string }) {
  const reasonId = useId();

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState<ReviewDetailResponse | null>(null);
  const [parent, setParent] = useState<PublicReport | null>(null);
  const [parentMissing, setParentMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({
    identity: false,
    claim: false,
    ingredients: false,
    explanation: false,
    personal: false,
    wording: false,
  });
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<DecisionAction | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [decided, setDecided] = useState<{ action: DecisionAction; state: string } | null>(null);
  const [openAsset, setOpenAsset] = useState<string | null>(null);
  const [keyFor, resetKey] = useActionKey();

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setStale(null);
    setDecisionError(null);
    setParent(null);
    setParentMissing(false);
    try {
      const result = await api.review.detail(revisionId);
      setDetail(result);
      setStatus("ready");
      if (result.content_kind === "response") {
        // A response revision's snapshot carries no product identity, so the
        // parent context comes from the published concern it will hang from.
        try {
          setParent(await api.feed.get(result.report_id));
        } catch {
          setParentMissing(true);
        }
      }
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, [revisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: DecisionAction) {
    if (!detail) return;
    setReasonError(null);
    setDecisionError(null);

    const trimmedReason = reason.trim();
    if ((action === "request_changes" || action === "reject") && !trimmedReason) {
      setReasonError("A reason is required before requesting changes or rejecting.");
      return;
    }

    setDeciding(action);
    try {
      const result = await api.review.decide(
        detail.publication_revision_id,
        {
          // The guard value comes from the revision that was actually loaded,
          // so a request that moved in between is refused rather than decided.
          expected_version: detail.version,
          action,
          ...(trimmedReason ? { reason: trimmedReason } : {}),
        },
        keyFor(`${action}:${trimmedReason}:${detail.version}`),
      );
      resetKey();
      setDecided({ action, state: result.state });
    } catch (err) {
      if (failureKind(err) === "conflict") {
        setStale(
          "This request changed since you loaded it. It may already have been decided, or the reporter may have withdrawn or revised it. Reload before reviewing.",
        );
      } else if (failureKind(err) === "forbidden") {
        setDecisionError("Reviewer access is required for this action.");
      } else if (failureKind(err) === "validation") {
        setDecisionError("That decision was refused. A reason is required for this action.");
      } else if (failureKind(err) === "unavailable") {
        setDecisionError(
          "The demo service could not be reached, so no decision was recorded. Your reason is still here — try again.",
        );
      } else {
        setDecisionError("That decision could not be recorded. Try again.");
      }
    } finally {
      setDeciding(null);
    }
  }

  if (status === "loading") {
    return (
      <>
        <p className={styles.back}>
          <Link href="/pilot/review">Back to the review queue</Link>
        </p>
        <LoadingBlock label="Loading this review request…" lines={5} />
      </>
    );
  }

  if (status === "error" || !detail) {
    const copy = loadFailureCopy(error);
    const forbidden = failureKind(error) === "forbidden";
    return (
      <>
        <p className={styles.back}>
          <Link href="/pilot/review">Back to the review queue</Link>
        </p>
        <StateBlock
          tone={forbidden ? "warning" : "error"}
          headingLevel="h1"
          title={copy.title}
          role="alert"
          actions={
            forbidden ? (
              <Link className="btn-primary" href="/pilot/feed">
                Go to the community feed
              </Link>
            ) : (
              <button type="button" className="btn-primary" onClick={() => void load()}>
                Retry
              </button>
            )
          }
        >
          <p>{copy.body}</p>
        </StateBlock>
      </>
    );
  }

  const isResponse = detail.content_kind === "response";
  const pending = detail.state === "pending_review";
  const decidedCopy = DECIDED_STATE_COPY[detail.state];
  const allChecked =
    EVIDENCE_CHECKS.every((check) => checks[check.key]) &&
    PRIVACY_CHECKS.every((check) => checks[check.key]);
  const assetCount = detail.asset_ids.length;
  const openIndex = openAsset ? detail.asset_ids.indexOf(openAsset) : -1;

  return (
    <>
      <p className={styles.back}>
        <Link href="/pilot/review">Back to the review queue</Link>
      </p>

      <header className={styles.head}>
        <p className={styles.kindTag}>
          {isResponse ? "Response update" : "Concern"} · revision {detail.revision} · requested{" "}
          {formatDateOr(detail.created_at)}
        </p>
        <h1 className={styles.title}>Review this request</h1>
        <p className={styles.lede}>
          Everything below is the frozen snapshot recorded when the reporter consented to
          publication. It is not re-read from their private report, so a later edit cannot
          change what you approve here.
        </p>
      </header>

      {decided ? (
        <StateBlock
          tone="warning"
          title={
            decided.action === "approve"
              ? "Approved for publication"
              : decided.action === "request_changes"
                ? "Changes requested"
                : "Request rejected"
          }
          role="status"
          actions={
            <>
              <Link className="btn-primary" href="/pilot/review">
                Back to the review queue
              </Link>
              {decided.action === "approve" ? (
                <Link href={`/pilot/concerns/${detail.report_id}`}>View the published concern</Link>
              ) : null}
            </>
          }
        >
          <p>
            {decided.action === "approve"
              ? "This exact snapshot is now visible to the pilot community. Approved for publication means the evidence and wording passed review — it is not a statement that the product is safe, and nothing has been filed with any authority."
              : "The reporter keeps their private record and can revise and resubmit. Nothing about this request is published."}
          </p>
        </StateBlock>
      ) : null}

      {stale ? (
        <StateBlock
          tone="error"
          title="This request changed. Reload before reviewing"
          role="alert"
          actions={
            <button type="button" className="btn-primary" onClick={() => void load()}>
              Reload this request
            </button>
          }
        >
          <p>{stale}</p>
        </StateBlock>
      ) : null}

      {!pending && !decided ? (
        <StateBlock tone="warning" title={decidedCopy?.title ?? "This request is not open"}>
          <p>{decidedCopy?.body ?? "It is no longer waiting for a decision."}</p>
          {detail.reason ? <p>Recorded reason: {detail.reason}</p> : null}
        </StateBlock>
      ) : null}

      {isResponse ? (
        <section className={styles.section} aria-labelledby="parent-heading">
          <h2 id="parent-heading" className={styles.sectionTitle}>
            Parent concern
          </h2>
          {parent ? (
            <>
              <p className={styles.parentTitle}>
                {productTitle(parent.product_name, parent.variant)} · {parent.brand}
              </p>
              <p className={styles.parentSummary}>{parent.concern_summary}</p>
              <p className={styles.footnote}>
                <Link href={`/pilot/concerns/${parent.report_id}`}>
                  Open the published concern
                </Link>{" "}
                — a response is attached to this concern and never replaces it.
              </p>
            </>
          ) : parentMissing ? (
            <p className="muted">
              The parent concern is not currently visible in the community feed. A response
              cannot be published while its parent is hidden.
            </p>
          ) : (
            <LoadingBlock label="Loading the parent concern…" lines={2} />
          )}
        </section>
      ) : null}

      <section className={styles.section} aria-labelledby="snapshot-heading">
        <h2 id="snapshot-heading" className={styles.sectionTitle}>
          Proposed community version
        </h2>
        <p className={styles.footnote}>
          This is exactly what would become visible. Nothing here is edited by the reviewer:
          if the wording needs to change, return it to the reporter so they consent to the
          new version.
        </p>
        <SnapshotView payload={detail.payload} />
      </section>

      <section className={styles.section} aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className={styles.sectionTitle}>
          Evidence in this request
        </h2>
        <p className={styles.footnote}>
          The frozen copies the reporter selected and consented to publish. They are served
          through the guarded media route for this review only.
        </p>
        {assetCount === 0 ? (
          <p className="muted">
            {isResponse
              ? "No attachment was selected for this response. A response summary can be reviewed without one."
              : "No evidence image is attached to this request."}
          </p>
        ) : (
          <ul className={styles.assetList}>
            {detail.asset_ids.map((assetId, index) => (
              <li key={assetId} className={styles.asset}>
                <button
                  type="button"
                  className={styles.assetButton}
                  onClick={() => setOpenAsset(assetId)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- guarded API route, unknown intrinsic size */}
                  <img
                    className={styles.assetImage}
                    src={publicationAssetUrl(assetId)}
                    alt={`Frozen evidence image ${index + 1} of ${assetCount} in this request`}
                  />
                  <span className={styles.assetCaption}>
                    Evidence {index + 1} of {assetCount} · open larger
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && !decided ? (
        <section className={styles.section} aria-labelledby="decision-heading">
          <h2 id="decision-heading" className={styles.sectionTitle}>
            Decision
          </h2>

          <fieldset className={styles.checklist}>
            <legend className={styles.legend}>Evidence checklist</legend>
            {EVIDENCE_CHECKS.map((check) => (
              <label key={check.key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={checks[check.key]}
                  onChange={(event) =>
                    setChecks((current) => ({ ...current, [check.key]: event.target.checked }))
                  }
                />
                {check.label}
              </label>
            ))}
          </fieldset>

          <fieldset className={styles.checklist}>
            <legend className={styles.legend}>Privacy and factual wording checklist</legend>
            {PRIVACY_CHECKS.map((check) => (
              <label key={check.key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={checks[check.key]}
                  onChange={(event) =>
                    setChecks((current) => ({ ...current, [check.key]: event.target.checked }))
                  }
                />
                {check.label}
              </label>
            ))}
          </fieldset>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={reasonId}>
              Reason or requested correction
            </label>
            <p className={styles.footnote} id={`${reasonId}-help`}>
              Required to request changes or to reject. It is recorded with the decision and
              shown to the reporter.
            </p>
            <textarea
              id={reasonId}
              className={styles.textarea}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={
                reasonError ? `${reasonId}-error ${reasonId}-help` : `${reasonId}-help`
              }
            />
            {reasonError ? (
              <p id={`${reasonId}-error`} className={styles.error} role="alert">
                {reasonError}
              </p>
            ) : null}
          </div>

          <div className={styles.decisionActions}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void decide("approve")}
              disabled={!allChecked || deciding !== null}
            >
              {deciding === "approve" ? "Approving…" : "Approve publication"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void decide("request_changes")}
              disabled={deciding !== null}
            >
              {deciding === "request_changes" ? "Sending…" : "Request changes"}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => void decide("reject")}
              disabled={deciding !== null}
            >
              {deciding === "reject" ? "Rejecting…" : "Reject"}
            </button>
          </div>

          {!allChecked ? (
            <p className={styles.footnote}>
              Approving needs every checklist item confirmed. Requesting changes and
              rejecting do not, but they need a reason.
            </p>
          ) : null}

          {decisionError ? (
            <InlineNote tone="error" role="alert">
              {decisionError}
            </InlineNote>
          ) : null}
        </section>
      ) : null}

      <ModerationActions reportId={detail.report_id} />

      {openIndex >= 0 && openAsset ? (
        <EvidenceViewer
          open
          src={publicationAssetUrl(openAsset)}
          alt={`Frozen evidence image ${openIndex + 1} of ${assetCount} in this request`}
          caption={`Evidence ${openIndex + 1} of ${assetCount} frozen in this review request`}
          onClose={() => setOpenAsset(null)}
        />
      ) : null}
    </>
  );
}
