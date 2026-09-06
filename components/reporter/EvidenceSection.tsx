"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { EvidenceMeta, EvidenceRole, ReportDetail } from "@/lib/contracts";
import { api, evidenceMediaUrl } from "@/lib/client/api";
import { toFailure, trackFlowError, useIdempotencyKeys, type Failure } from "./failure";
import { FailureNotice } from "./ui";
import styles from "./reporter.module.css";

/**
 * Evidence step of the guided editor (docs/FOODPROOF_SCREENS.md §5.2).
 * One file per request, ≤ 3 MB, JPEG/PNG/WebP for label images — the same
 * limits the server enforces and sniffs (lib/server/evidence.ts). Roles are
 * identity / claim / ingredients and one image may carry several. Only READY
 * label images count toward the server's readiness rule, and evidence that is
 * frozen into a pending review request cannot be changed until that request is
 * withdrawn — the server refuses it and this screen says so first.
 */

export const ROLE_LABEL: Record<EvidenceRole, string> = {
  identity: "Product identity",
  claim: "Gluten-free claim",
  ingredients: "Ingredient list",
};

const ROLES: EvidenceRole[] = ["identity", "claim", "ingredients"];
const MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Roles covered by ready label images — the server's readiness inputs. */
export function coveredRoles(report: ReportDetail): Set<EvidenceRole> {
  const covered = new Set<EvidenceRole>();
  for (const item of report.evidence) {
    if (item.kind !== "label" || item.upload_state !== "ready") continue;
    for (const role of item.roles) covered.add(role);
  }
  return covered;
}

export function readyLabelEvidence(report: ReportDetail): EvidenceMeta[] {
  return report.evidence.filter(
    (item) => item.kind === "label" && item.upload_state === "ready",
  );
}

/**
 * What the upload indicator shows. `sending` is the request body leaving the
 * browser; `confirming` is the wait for the server's answer, during which
 * nothing is stored yet; `done` and `failed` stay on screen after the attempt so
 * the reporter can see how it ended.
 */
type UploadPhase = "sending" | "confirming" | "done" | "failed";
interface UploadProgressState {
  percent: number;
  phase: UploadPhase;
}

function progressText(progress: UploadProgressState): string {
  switch (progress.phase) {
    case "sending":
      return `Uploading… ${progress.percent}% sent.`;
    case "confirming":
      return "File sent. Waiting for the demo service to confirm it was stored — nothing is saved until it does.";
    case "done":
      return "Upload complete. The demo service confirmed the file was stored.";
    case "failed":
      return `Upload failed at ${progress.percent}%. Nothing was saved and your file, type and roles are still selected — retry below.`;
  }
}

/** The last per-file action, so a failure notice can retry that exact call. */
type RowAction =
  | { type: "roles"; evidence: EvidenceMeta; role: EvidenceRole; checked: boolean }
  | { type: "remove"; evidence: EvidenceMeta };

function kilobytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function EvidenceSection({
  report,
  onChanged,
}: {
  report: ReportDetail;
  onChanged: () => Promise<void>;
}) {
  const { keyFor, settled } = useIdempotencyKeys();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<"label" | "receipt">("label");
  const [roles, setRoles] = useState<EvidenceRole[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgressState | null>(null);
  const [uploadFailure, setUploadFailure] = useState<Failure | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busyEvidenceId, setBusyEvidenceId] = useState<string | null>(null);
  const [rowFailure, setRowFailure] = useState<Failure | null>(null);
  /** The last per-file action, so its failure notice can retry that same call. */
  const [lastRowAction, setLastRowAction] = useState<RowAction | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const pendingReview = report.community_visibility === "pending_review";
  const labelEvidence = useMemo(
    () => report.evidence.filter((item) => item.kind === "label"),
    [report.evidence],
  );
  const otherEvidence = useMemo(
    () => report.evidence.filter((item) => item.kind !== "label"),
    [report.evidence],
  );

  const validateLocally = useCallback(
    (candidate: File): string | null => {
      if (candidate.size === 0) return "That file is empty. Choose another image.";
      if (candidate.size > MAX_BYTES) {
        return `That file is ${kilobytes(candidate.size)}. The limit is 3 MB — choose a smaller image.`;
      }
      if (kind === "label" && candidate.type && !IMAGE_TYPES.includes(candidate.type)) {
        return "Label photos must be a JPEG, PNG or WebP image.";
      }
      return null;
    },
    [kind],
  );

  const upload = useCallback(async () => {
    if (!file) {
      setLocalError("Choose a file first.");
      return;
    }
    const problem = validateLocally(file);
    if (problem) {
      setLocalError(problem);
      return;
    }
    setLocalError(null);
    setUploading(true);
    setProgress({ percent: 0, phase: "sending" });
    setAnnouncement("Uploading your file. Nothing is saved until it succeeds.");
    // The retry of a failed upload reuses this key, so a request that actually
    // reached the server is replayed instead of stored twice.
    const key = keyFor("evidence.upload", {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      kind,
      roles,
    });
    try {
      await api.evidence.upload(
        report.report_id,
        { file, kind, roles: kind === "label" ? roles : [] },
        key,
        {
          onProgress: ({ fraction }) =>
            setProgress({
              percent: Math.round(fraction * 100),
              // A fully sent body is not a stored file: say so until the server
              // answers.
              phase: fraction >= 1 ? "confirming" : "sending",
            }),
        },
      );
      settled("evidence.upload");
      setProgress({ percent: 100, phase: "done" });
      setUploadFailure(null);
      setFile(null);
      setRoles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setAnnouncement("Upload saved.");
      await onChanged();
    } catch (error) {
      const failure = toFailure(error);
      setUploadFailure(failure);
      // Keep the percentage the attempt reached; the retry starts from zero.
      setProgress((current) => ({ percent: current?.percent ?? 0, phase: "failed" }));
      trackFlowError("upload", failure);
      setAnnouncement("Upload failed. Your file is still selected — retry below.");
    } finally {
      setUploading(false);
    }
  }, [file, kind, keyFor, onChanged, report.report_id, roles, settled, validateLocally]);

  const toggleRole = useCallback(
    async (evidence: EvidenceMeta, role: EvidenceRole, checked: boolean) => {
      setLastRowAction({ type: "roles", evidence, role, checked });
      const next = checked
        ? Array.from(new Set([...evidence.roles, role]))
        : evidence.roles.filter((item) => item !== role);
      setBusyEvidenceId(evidence.id);
      setRowFailure(null);
      const key = keyFor(`evidence.roles:${evidence.id}`, {
        roles: next,
        version: report.version,
      });
      try {
        await api.evidence.patchRoles(
          evidence.id,
          { roles: next, report_expected_version: report.version },
          key,
        );
        settled(`evidence.roles:${evidence.id}`);
        setAnnouncement("Evidence roles updated.");
        await onChanged();
      } catch (error) {
        // A pending review is the blocker the server reports as CONFLICT here;
        // an expected_version mismatch is the other one. The screen knows which
        // situation it is in, so it says — it never reads the message text.
        const failure = toFailure(error, { conflictAs: pendingReview ? "locked" : "stale" });
        setRowFailure(failure);
        trackFlowError("save", failure);
      } finally {
        setBusyEvidenceId(null);
      }
    },
    [keyFor, onChanged, pendingReview, report.version, settled],
  );

  const remove = useCallback(
    async (evidence: EvidenceMeta) => {
      setLastRowAction({ type: "remove", evidence });
      const confirmed = window.confirm(
        "Remove this file from the report? The private original is deleted. Anything already approved for the community keeps its own reviewed copy.",
      );
      if (!confirmed) return;
      setBusyEvidenceId(evidence.id);
      setRowFailure(null);
      const key = keyFor(`evidence.remove:${evidence.id}`, { id: evidence.id });
      try {
        await api.evidence.remove(evidence.id, key);
        settled(`evidence.remove:${evidence.id}`);
        setAnnouncement("File removed.");
        await onChanged();
      } catch (error) {
        const failure = toFailure(error, { conflictAs: pendingReview ? "locked" : "stale" });
        setRowFailure(failure);
        trackFlowError("save", failure);
      } finally {
        setBusyEvidenceId(null);
      }
    },
    [keyFor, onChanged, pendingReview, settled],
  );

  const retryLastRowAction = useCallback(() => {
    if (!lastRowAction) return;
    if (lastRowAction.type === "roles") {
      void toggleRole(lastRowAction.evidence, lastRowAction.role, lastRowAction.checked);
      return;
    }
    void remove(lastRowAction.evidence);
  }, [lastRowAction, remove, toggleRole]);

  return (
    <div>
      <p className={styles.small}>
        Show the product identity, the gluten-free claim and the ingredient list.
        One photo can cover more than one of them. JPEG, PNG or WebP, up to 3 MB
        each, one file at a time. Use sample or redacted images only.
      </p>

      {pendingReview ? (
        <p className={styles.inset}>
          A review request is waiting with the owner, so the roles and the remove
          button are locked on every stored file — the owner is reviewing exactly
          these images. You can still add new files.{" "}
          <Link href={`/pilot/reports/${report.report_id}/share`}>
            Withdraw the request on the community sharing screen
          </Link>{" "}
          to change them.
        </p>
      ) : null}

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>

      <div className={styles.panel}>
        <h3 className={styles.subTitle}>Add a file</h3>
        <label className={styles.label} htmlFor={`${fileInputId}-kind`}>
          What is this file?
        </label>
        <select
          id={`${fileInputId}-kind`}
          className={styles.select}
          value={kind}
          disabled={uploading}
          onChange={(event) => {
            setKind(event.target.value === "receipt" ? "receipt" : "label");
            setRoles([]);
          }}
        >
          <option value="label">Label photo</option>
          <option value="receipt">Purchase receipt (optional, never shared by default)</option>
        </select>

        <label className={styles.label} htmlFor={fileInputId}>
          Choose a file
        </label>
        <input
          id={fileInputId}
          ref={fileInputRef}
          className={styles.input}
          type="file"
          accept={kind === "label" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,application/pdf"}
          disabled={uploading}
          aria-describedby={localError ? `${fileInputId}-error` : undefined}
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            setFile(chosen);
            setUploadFailure(null);
            setProgress(null);
            setLocalError(chosen ? validateLocally(chosen) : null);
          }}
        />
        {localError ? (
          <span className={styles.fieldError} id={`${fileInputId}-error`}>
            {localError}
          </span>
        ) : null}
        {file ? (
          <p className={styles.small}>
            Selected: {file.name} ({kilobytes(file.size)})
          </p>
        ) : null}

        {kind === "label" ? (
          <fieldset className={styles.roleSet}>
            <legend>What does this photo show? (optional now, required to share)</legend>
            <div className={styles.roleOptions}>
              {ROLES.map((role) => (
                <label className={styles.roleOption} key={role}>
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    disabled={uploading}
                    onChange={(event) =>
                      setRoles((current) =>
                        event.target.checked
                          ? Array.from(new Set([...current, role]))
                          : current.filter((item) => item !== role),
                      )
                    }
                  />
                  {ROLE_LABEL[role]}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void upload()}
            disabled={uploading || !file}
          >
            {uploading ? "Uploading…" : uploadFailure ? "Retry this upload" : "Upload file"}
          </button>
        </div>
        {progress ? (
          <div className={styles.progressBlock}>
            <div
              className={styles.progressTrack}
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-valuetext={progressText(progress)}
            >
              <div
                className={
                  progress.phase === "failed"
                    ? `${styles.progressBar} ${styles.progressBarFailed}`
                    : styles.progressBar
                }
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className={styles.small}>{progressText(progress)}</p>
          </div>
        ) : null}
        {uploadFailure ? (
          <FailureNotice failure={uploadFailure} onRetry={() => void upload()} retryLabel="Retry upload" />
        ) : null}
      </div>

      <h3 className={styles.subTitle}>Label photos ({labelEvidence.length})</h3>
      {rowFailure ? (
        <FailureNotice
          failure={rowFailure}
          onRetry={
            rowFailure.kind === "locked" || !lastRowAction ? undefined : retryLastRowAction
          }
          onReload={rowFailure.kind === "stale" ? () => void onChanged() : undefined}
          retryLabel="Try that change again"
        />
      ) : null}
      {labelEvidence.length === 0 ? (
        <p className={styles.small}>No label photo has been uploaded yet.</p>
      ) : (
        <ul className={styles.evidenceGrid}>
          {labelEvidence.map((item) => (
            <li className={styles.evidenceCard} key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- guarded, cookie-authenticated media route; not an optimizable public asset. */}
              <img
                className={styles.thumb}
                src={evidenceMediaUrl(item.id)}
                alt={
                  item.roles.length
                    ? `Uploaded label photo showing: ${item.roles.map((role) => ROLE_LABEL[role]).join(", ")}`
                    : "Uploaded label photo with no role assigned yet"
                }
              />
              <p className={styles.small}>
                {item.mime_type} · {kilobytes(item.bytes)} ·{" "}
                {item.upload_state === "ready" ? "Stored" : `Upload ${item.upload_state}`}
              </p>
              <fieldset className={styles.roleSet}>
                <legend>Roles for this photo</legend>
                <div className={styles.roleOptions}>
                  {ROLES.map((role) => (
                    <label className={styles.roleOption} key={role}>
                      <input
                        type="checkbox"
                        checked={item.roles.includes(role)}
                        disabled={busyEvidenceId === item.id || pendingReview}
                        onChange={(event) =>
                          void toggleRole(item, role, event.target.checked)
                        }
                      />
                      {ROLE_LABEL[role]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button
                type="button"
                className={styles.btnDanger}
                disabled={busyEvidenceId === item.id || pendingReview}
                onClick={() => void remove(item)}
              >
                Remove file
              </button>
              {pendingReview ? (
                <p className={styles.small}>
                  Locked while the owner reviews this request.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {otherEvidence.length > 0 ? (
        <>
          <h3 className={styles.subTitle}>Other files ({otherEvidence.length})</h3>
          <ul className={styles.rows}>
            {otherEvidence.map((item) => (
              <li className={styles.row} key={item.id}>
                <div className={styles.rowMain}>
                  <p className={styles.pre}>
                    {item.kind === "receipt" ? "Purchase receipt" : null}
                    {item.kind === "acknowledgement" ? "Acknowledgement file" : null}
                    {item.kind === "response" ? "Response attachment" : null}
                  </p>
                  <p className={styles.small}>
                    {item.mime_type} · {kilobytes(item.bytes)} · never selected for
                    the community by default
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnDanger}
                  disabled={busyEvidenceId === item.id || pendingReview}
                  onClick={() => void remove(item)}
                >
                  Remove file
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={styles.footnote}>
        Original files stay private. A community version is a separate reviewed
        copy, made only when you request a review and the owner approves it.
      </p>
    </div>
  );
}
