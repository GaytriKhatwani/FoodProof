"use client";

import { useCallback, useState } from "react";
import type {
  Channel,
  EvidenceMeta,
  ReportDetail,
  ReportUpdate,
  Submission,
} from "@/lib/contracts";
import { api, evidenceMediaUrl } from "@/lib/client/api";
import { Modal } from "./Modal";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import { FailureNotice, TextAreaField, TextField, cx, formatDate, todayIso } from "./ui";
import styles from "./reporter.module.css";

/**
 * Dialogs for the private timeline (docs/FOODPROOF_SCREENS.md §7 record
 * submission, §8 follow-up and closure, §9 response entry and response sharing).
 *
 * Everything recorded here is reporter-supplied: FoodProof never sends a
 * complaint, never confirms delivery, and never verifies a response. Each dialog
 * keeps its values on a failure and retries under the same Idempotency-Key.
 */

const MAX_BYTES = 3 * 1024 * 1024;

/** Upload one attachment and return its evidence id, or reuse an earlier one. */
async function uploadAttachment(
  reportId: string,
  file: File,
  kind: "acknowledgement" | "response",
  key: string,
): Promise<EvidenceMeta> {
  return api.evidence.upload(reportId, { file, kind }, key);
}

function fileProblem(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return "That file is over the 3 MB limit.";
  return null;
}

// ---------------------------------------------------------------------------
// Record an external submission
// ---------------------------------------------------------------------------

export function SubmissionDialog({
  report,
  channel,
  onClose,
  onSaved,
}: {
  report: ReportDetail;
  channel: Channel;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const [recipient, setRecipient] = useState("");
  const [submittedAt, setSubmittedAt] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    const nextErrors: Record<string, string> = {};
    if (!recipient.trim()) {
      nextErrors.recipient = "Enter who you sent it to, as you addressed it.";
    }
    if (!submittedAt) nextErrors.submitted_at = "Enter the date you sent it.";
    else if (submittedAt > todayIso()) nextErrors.submitted_at = "That date is in the future.";
    if (file) {
      const problem = fileProblem(file);
      if (problem) nextErrors.file = problem;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      let acknowledgementId = uploadedId;
      if (file && !acknowledgementId) {
        const uploadKey = keyFor("submission.attachment", {
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
        });
        const evidence = await uploadAttachment(
          report.report_id,
          file,
          "acknowledgement",
          uploadKey,
        );
        settled("submission.attachment");
        acknowledgementId = evidence.id;
        setUploadedId(evidence.id);
      }
      const body = {
        channel,
        recipient: recipient.trim(),
        submitted_at: submittedAt,
        reference: reference.trim() ? reference.trim() : null,
        acknowledgement_evidence_id: acknowledgementId,
      };
      const key = keyFor("submission.create", body);
      await api.submissions.create(report.report_id, body, key);
      settled("submission.create");
      await onSaved();
      onClose();
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      if (next.fields) setErrors(next.fields);
      trackFlowError("save", next);
    } finally {
      setSaving(false);
    }
  }, [
    channel,
    file,
    keyFor,
    onClose,
    onSaved,
    recipient,
    reference,
    report.report_id,
    settled,
    submittedAt,
    uploadedId,
  ]);

  return (
    <Modal
      title={channel === "brand" ? "Record a message you sent the brand" : "Record a complaint you sent an authority"}
      onClose={onClose}
    >
      <p className={styles.inset}>
        This records something you did outside FoodProof. It does not send
        anything, and it is not proof that your message arrived.
      </p>
      <TextField
        id="submission-recipient"
        label={channel === "brand" ? "Who you sent it to" : "Which authority or portal"}
        value={recipient}
        error={errors.recipient}
        hint="Type it exactly as you addressed it. FoodProof never guesses an address."
        onChange={setRecipient}
      />
      <TextField
        id="submission-date"
        label="Date you sent it"
        type="date"
        max={todayIso()}
        value={submittedAt}
        error={errors.submitted_at}
        onChange={setSubmittedAt}
      />
      <TextField
        id="submission-reference"
        label="Reference or ticket number (optional)"
        value={reference}
        onChange={setReference}
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="submission-attachment">
          Acknowledgement file (optional)
        </label>
        <input
          id="submission-attachment"
          className={styles.input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-invalid={errors.file ? true : undefined}
          aria-describedby={cx(
            "submission-attachment-hint",
            errors.file && "submission-attachment-error",
          )}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setUploadedId(null);
          }}
        />
        <span className={styles.hint} id="submission-attachment-hint">
          Up to 3 MB. An attachment is evidence you provide — it is not
          independent confirmation that anyone received or accepted your message.
        </span>
        {errors.file ? (
          <span className={styles.fieldError} id="submission-attachment-error">
            {errors.file}
          </span>
        ) : null}
      </div>
      {failure ? <FailureNotice failure={failure} onRetry={() => void submit()} /> : null}
      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : "Save submission record"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Record a response to a submission (§9)
// ---------------------------------------------------------------------------

export function ResponseDialog({
  report,
  submission,
  onClose,
  onSaved,
  onShareResponse,
}: {
  report: ReportDetail;
  submission: Submission;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onShareResponse: (update: ReportUpdate) => void;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const [sender, setSender] = useState("");
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [summary, setSummary] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ReportUpdate | null>(null);

  const submit = useCallback(async () => {
    const nextErrors: Record<string, string> = {};
    if (!sender.trim()) nextErrors.sender = "Enter who replied.";
    if (!occurredAt) nextErrors.occurred_at = "Enter the date of the response.";
    else if (occurredAt > todayIso()) nextErrors.occurred_at = "That date is in the future.";
    if (!summary.trim()) nextErrors.summary = "Summarise what they said.";
    if (file) {
      const problem = fileProblem(file);
      if (problem) nextErrors.file = problem;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setFailure(null);
    try {
      let attachmentId = uploadedId;
      if (file && !attachmentId) {
        const uploadKey = keyFor("response.attachment", {
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
        });
        const evidence = await uploadAttachment(report.report_id, file, "response", uploadKey);
        settled("response.attachment");
        attachmentId = evidence.id;
        setUploadedId(evidence.id);
      }
      const body = {
        submission_id: submission.id,
        kind: "response" as const,
        sender: sender.trim(),
        occurred_at: occurredAt,
        summary: summary.trim(),
        evidence_id: attachmentId,
      };
      const key = keyFor("update.response", body);
      const update = await api.updates.create(report.report_id, body, key);
      settled("update.response");
      setSaved(update);
      await onSaved();
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      if (next.fields) setErrors(next.fields);
      trackFlowError("save", next);
    } finally {
      setSaving(false);
    }
  }, [
    file,
    keyFor,
    occurredAt,
    onSaved,
    report.report_id,
    sender,
    settled,
    submission.id,
    summary,
    uploadedId,
  ]);

  if (saved) {
    return (
      <Modal title="Response saved privately" onClose={onClose}>
        <p>
          The response is on your private record. Nothing about it is visible to
          the community, and saving it did not close your report.
        </p>
        <p className={styles.small}>
          You can propose a redacted version of this response for owner review as
          a separate, deliberate step.
        </p>
        <div className={cx(styles.actions, styles.spread)}>
          <button type="button" className={styles.btnQuiet} onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => onShareResponse(saved)}
          >
            Preview response for sharing
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Record a response" onClose={onClose}>
      <p className={styles.small}>
        For your {submission.channel === "brand" ? "brand" : "official"} submission
        to {submission.recipient}, sent {formatDate(submission.submitted_at)}.
      </p>
      <TextField
        id="response-sender"
        label="Who replied"
        value={sender}
        error={errors.sender}
        onChange={setSender}
      />
      <TextField
        id="response-date"
        label="Response date"
        type="date"
        max={todayIso()}
        value={occurredAt}
        error={errors.occurred_at}
        onChange={setOccurredAt}
      />
      <TextAreaField
        id="response-summary"
        label="What did they say?"
        rows={4}
        value={summary}
        error={errors.summary}
        hint="Summarise it factually. Leave out contact details and anything private."
        onChange={setSummary}
      />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="response-attachment">
          Supporting screenshot or document (optional)
        </label>
        <input
          id="response-attachment"
          className={styles.input}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-invalid={errors.file ? true : undefined}
          aria-describedby={cx(
            "response-attachment-hint",
            errors.file && "response-attachment-error",
          )}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setUploadedId(null);
          }}
        />
        <span className={styles.hint} id="response-attachment-hint">
          Up to 3 MB, kept private. Only an image can later be proposed for
          community review.
        </span>
        {errors.file ? (
          <span className={styles.fieldError} id="response-attachment-error">
            {errors.file}
          </span>
        ) : null}
      </div>
      <p className={styles.inset}>
        This response stays private unless you separately request sharing and the
        owner approves it.
      </p>
      {failure ? <FailureNotice failure={failure} onRetry={() => void submit()} /> : null}
      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : "Save private response"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Record a manual follow-up (no reminders, no scheduling)
// ---------------------------------------------------------------------------

export function FollowUpDialog({
  report,
  submission,
  onClose,
  onSaved,
}: {
  report: ReportDetail;
  submission: Submission;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [summary, setSummary] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    const nextErrors: Record<string, string> = {};
    if (!occurredAt) nextErrors.occurred_at = "Enter the date of this follow-up.";
    else if (occurredAt > todayIso()) nextErrors.occurred_at = "That date is in the future.";
    if (!summary.trim()) nextErrors.summary = "Describe what you did.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setFailure(null);
    const body = {
      submission_id: submission.id,
      kind: "follow_up" as const,
      occurred_at: occurredAt,
      summary: summary.trim(),
    };
    const key = keyFor("update.follow_up", body);
    try {
      await api.updates.create(report.report_id, body, key);
      settled("update.follow_up");
      await onSaved();
      onClose();
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      if (next.fields) setErrors(next.fields);
      trackFlowError("save", next);
    } finally {
      setSaving(false);
    }
  }, [keyFor, occurredAt, onClose, onSaved, report.report_id, settled, submission.id, summary]);

  return (
    <Modal title="Record a follow-up" onClose={onClose}>
      <p className={styles.small}>
        For your {submission.channel === "brand" ? "brand" : "official"} submission
        to {submission.recipient}. FoodProof has no reminders and sends nothing —
        this only records something you already did.
      </p>
      <TextField
        id="followup-date"
        label="Date"
        type="date"
        max={todayIso()}
        value={occurredAt}
        error={errors.occurred_at}
        onChange={setOccurredAt}
      />
      <TextAreaField
        id="followup-summary"
        label="What did you do?"
        rows={3}
        value={summary}
        error={errors.summary}
        onChange={setSummary}
      />
      {failure ? <FailureNotice failure={failure} onRetry={() => void submit()} /> : null}
      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : "Save follow-up"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Close / reopen personal follow-up
// ---------------------------------------------------------------------------

export function CloseDialog({
  report,
  onClose,
  onSaved,
}: {
  report: ReportDetail;
  onClose: () => void;
  onSaved: (detail: ReportDetail) => void;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setError(undefined);
    setSaving(true);
    setFailure(null);
    const body = { reason: reason.trim() };
    const key = keyFor("report.close", body);
    try {
      const detail = await api.reports.close(report.report_id, body, key);
      settled("report.close");
      onSaved(detail);
      onClose();
    } catch (caught) {
      const next = toFailure(caught);
      setFailure(next);
      trackFlowError("save", next);
    } finally {
      setSaving(false);
    }
  }, [keyFor, onClose, onSaved, reason, report.report_id, settled]);

  return (
    <Modal title="Close my follow-up" onClose={onClose}>
      <p className={styles.inset}>
        Closing records that you have stopped pursuing this yourself. It does not
        establish that the product is safe, that the label was fixed, or that
        anything was resolved — and it does not remove a published community
        version.
      </p>
      <TextAreaField
        id="close-reason"
        label="Why are you stopping?"
        rows={3}
        value={reason}
        error={error}
        hint="Kept private. You can reopen this report at any time."
        onChange={setReason}
      />
      {failure ? <FailureNotice failure={failure} onRetry={() => void submit()} /> : null}
      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={saving}>
          {saving ? "Saving…" : "Close my follow-up"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Propose a recorded response for owner review (§9)
// ---------------------------------------------------------------------------

export function ResponseShareDialog({
  report,
  update,
  onClose,
  onSaved,
}: {
  report: ReportDetail;
  update: ReportUpdate;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const [selected, setSelected] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);

  const shareableImages = report.evidence.filter(
    (item) => item.upload_state === "ready" && item.mime_type.startsWith("image/"),
  );
  const published = report.community_visibility === "published";

  const submit = useCallback(async () => {
    if (!consent) {
      setBlocked("Tick the consent box before requesting a review.");
      return;
    }
    setBlocked(null);
    setSaving(true);
    setFailure(null);
    const body = {
      expected_version: report.version,
      consent: true as const,
      selected_evidence_ids: selected,
      source_update_id: update.id,
    };
    const key = keyFor("publication.response", body);
    // As on the sharing screen: a CONFLICT means "already waiting with the
    // owner" when this report already has a response request pending.
    const alreadyPending = report.review_requests.some(
      (request) => request.content_kind === "response" && request.state === "pending_review",
    );
    try {
      await api.publicationRequests.create(report.report_id, body, key);
      settled("publication.response");
      await onSaved();
      onClose();
    } catch (error) {
      const next = toFailure(error, alreadyPending ? { conflictAs: "already_pending" } : {});
      setFailure(next);
      trackFlowError("publish", next);
    } finally {
      setSaving(false);
    }
  }, [
    consent,
    keyFor,
    onClose,
    onSaved,
    report.review_requests,
    report.report_id,
    report.version,
    selected,
    settled,
    update.id,
  ]);

  return (
    <Modal title="Preview this response for sharing" onClose={onClose}>
      {!published ? (
        <p className={styles.alert} role="alert">
          A response can only be proposed for review while its concern is
          published in the community. Publish the concern first.
        </p>
      ) : null}

      <h3 className={styles.subTitle}>What the community would see</h3>
      <dl className={styles.defs}>
        <div className={styles.defRow}>
          <dt>Recorded by</dt>
          <dd>Reporter (anonymous)</dd>
        </div>
        <div className={styles.defRow}>
          <dt>Response date</dt>
          <dd>{formatDate(update.occurred_at)}</dd>
        </div>
        <div className={styles.defRow}>
          <dt>Summary</dt>
          <dd className={styles.pre}>{update.summary}</dd>
        </div>
      </dl>
      <p className={styles.small}>
        The sender’s name and any contact details stay private. Redaction is not
        automatic — if the summary or an image shows something private, edit or
        replace it before requesting a review.
      </p>

      <h3 className={styles.subTitle}>Images to include (optional)</h3>
      <p className={styles.small}>
        You can propose the summary on its own. If you select nothing, the
        reviewed version simply records that no attachment was provided.
      </p>
      {shareableImages.length === 0 ? (
        <p className={styles.small}>
          This report has no stored image to offer, so only the summary above
          would be reviewed.
        </p>
      ) : (
        <ul className={styles.evidenceGrid}>
          {shareableImages.map((item) => (
            <li className={styles.evidenceCard} key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- guarded, cookie-authenticated media route. */}
              <img
                className={styles.thumbSmall}
                src={evidenceMediaUrl(item.id)}
                alt={`Stored ${item.kind} image`}
              />
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>Include this {item.kind} image</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />
        <span>
          I want this response summary, and any images I selected, sent to the
          owner for review.
        </span>
      </label>

      {blocked ? (
        <p className={styles.alert} role="alert">
          {blocked}
        </p>
      ) : null}
      {failure ? <FailureNotice failure={failure} onRetry={() => void submit()} /> : null}

      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={onClose} disabled={saving}>
          Keep it private
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={() => void submit()}
          disabled={saving || !published}
        >
          {saving ? "Sending…" : "Request response review"}
        </button>
      </div>
      <p className={styles.footnote}>
        Requesting a review sends nothing outside FoodProof. The owner decides
        whether this summary is published in the pilot community.
      </p>
    </Modal>
  );
}
