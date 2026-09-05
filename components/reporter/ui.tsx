"use client";

import type { ReactNode } from "react";
import type {
  CommunityVisibility,
  Lifecycle,
  Preparation,
  RevisionState,
} from "@/lib/contracts";
import type { Failure } from "./failure";
import styles from "./reporter.module.css";

/**
 * Small presentational pieces shared by the reporter screens. All status wording
 * lives here so the three separate dimensions — preparation, community
 * visibility and personal follow-up (docs/FOODPROOF_SCREENS.md §8) — are worded
 * identically everywhere and never imply filing, delivery or product safety.
 */

export const PREPARATION_LABEL: Record<Preparation, string> = {
  draft: "Draft",
  ready: "Ready to request review",
};

export const VISIBILITY_LABEL: Record<CommunityVisibility, string> = {
  private: "Private",
  pending_review: "Sent for owner review",
  changes_requested: "Changes requested",
  rejected: "Not approved",
  published: "Published in the pilot community",
  withdrawn: "Withdrawn from the community",
  removed: "Removed by the owner",
};

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  open: "Open",
  closed_by_reporter: "Closed by reporter",
};

export const REVISION_STATE_LABEL: Record<RevisionState, string> = {
  pending_review: "Sent for owner review",
  changes_requested: "Changes requested",
  rejected: "Not approved",
  approved: "Approved for publication",
  withdrawn: "Withdrawn",
  removed: "Removed by the owner",
};

/** Join class names, dropping the empty ones (CSS-module lookups are optional). */
export function cx(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Status colour is only ever an accent — the word carries the meaning. */
function chipTone(kind: "attention" | "active" | "plain"): string {
  if (kind === "attention") return cx(styles.chip, styles.chipAttention);
  if (kind === "active") return cx(styles.chip, styles.chipActive);
  return cx(styles.chip);
}

export function StatusChips({
  preparation,
  visibility,
  lifecycle,
}: {
  preparation: Preparation;
  visibility: CommunityVisibility;
  lifecycle: Lifecycle;
}) {
  return (
    <ul className={styles.chips}>
      <li className={chipTone(preparation === "ready" ? "active" : "plain")}>
        <span className={styles.chipLabel}>Preparation</span>{" "}
        <span className={styles.chipValue}>{PREPARATION_LABEL[preparation]}</span>
      </li>
      <li
        className={chipTone(
          visibility === "changes_requested" || visibility === "rejected"
            ? "attention"
            : visibility === "private"
              ? "plain"
              : "active",
        )}
      >
        <span className={styles.chipLabel}>Community</span>{" "}
        <span className={styles.chipValue}>{VISIBILITY_LABEL[visibility]}</span>
      </li>
      <li className={chipTone("plain")}>
        <span className={styles.chipLabel}>Follow-up</span>{" "}
        <span className={styles.chipValue}>{LIFECYCLE_LABEL[lifecycle]}</span>
      </li>
    </ul>
  );
}

/** Sample/redacted-only reminder required on every pilot screen. */
export function DemoDataNote({ children }: { children?: ReactNode }) {
  return (
    <p className={styles.inset}>
      Private demo record — use sample or redacted information only. Nothing here
      is sent to a brand or an authority.{children ? <> {children}</> : null}
    </p>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className={styles.small}>
      Loading {what}…
    </p>
  );
}

/**
 * The one place a failure becomes visible text. `onRetry` re-runs the exact
 * failed operation; `onReload` re-reads the server copy after a stale-version
 * conflict. Neither ever discards what the user typed.
 */
export function FailureNotice({
  failure,
  onRetry,
  onReload,
  retryLabel = "Try again",
}: {
  failure: Failure;
  onRetry?: () => void;
  onReload?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className={styles.alert} role="alert">
      {failure.kind === "unavailable" ? (
        <>
          <p>Demo backend unavailable.</p>
          <p>
            This screen could not reach the demo service, so nothing was saved.
            There is no offline copy of your report.
          </p>
        </>
      ) : null}
      {failure.kind === "session_lost" ? (
        <>
          <p>Your demo session has ended.</p>
          <p>
            Enter the pilot again with your invitation to continue. Everything you
            typed is still on this screen.
          </p>
        </>
      ) : null}
      {failure.kind === "stale" ? (
        <>
          <p>This record changed since you loaded it.</p>
          <p>{failure.message}</p>
          <p>
            Everything you typed stays on this screen. Reload the saved version to
            pick up the latest change, check your text against it, then save again.
          </p>
        </>
      ) : null}
      {failure.kind === "locked" ? (
        <>
          <p>This file is part of a review request waiting with the owner.</p>
          <p>
            Reloading will not help. Withdraw that request on the community
            sharing screen, then change or remove the file.
          </p>
        </>
      ) : null}
      {failure.kind === "already_pending" ? (
        <>
          <p>A review request is already waiting with the owner.</p>
          <p>
            Reloading will not help. Withdraw the pending request first if you
            want to propose a different version.
          </p>
        </>
      ) : null}
      {failure.kind === "not_found" ? (
        <>
          <p>This record is not available.</p>
          <p>It may have been deleted, or it belongs to another demo session.</p>
        </>
      ) : null}
      {failure.kind === "rate_limited" ? (
        <>
          <p>Too many attempts.</p>
          <p>
            Wait
            {failure.retryAfterSeconds
              ? ` about ${failure.retryAfterSeconds} seconds`
              : " a moment"}{" "}
            and try again.
          </p>
        </>
      ) : null}
      {failure.kind === "validation" || failure.kind === "unknown" ? (
        <p>{failure.message}</p>
      ) : null}
      {onRetry || onReload ? (
        <div className={styles.actions}>
          {onRetry ? (
            <button type="button" className={styles.btnSecondary} onClick={onRetry}>
              {retryLabel}
            </button>
          ) : null}
          {onReload ? (
            <button type="button" className={styles.btnSecondary} onClick={onReload}>
              Reload the saved version
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Persistent inline save state; a toast never replaces it. */
export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "failed" }) {
  if (state === "idle") return null;
  return (
    <p className={styles.saveState} role="status" aria-live="polite">
      {state === "saving" ? "Saving…" : null}
      {state === "saved" ? "Saved to the demo service." : null}
      {state === "failed" ? "Couldn’t save. Your text is still here — retry below." : null}
    </p>
  );
}

/**
 * Labelled text input. The visible label is the only accessible name; hint and
 * error text are linked with `aria-describedby` instead of being folded into it,
 * and an invalid field is marked with `aria-invalid` — not colour alone.
 */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  type = "text",
  max,
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  type?: "text" | "date" | "email";
  max?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const describedBy = cx(hint && `${id}-hint`, error && `${id}-error`);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cx(styles.input, error && styles.inputInvalid)}
        type={type}
        value={value}
        max={max}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.fieldError} id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Multi-line variant of {@link TextField}, with the same description wiring. */
export function TextAreaField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  rows = 4,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const describedBy = cx(hint && `${id}-hint`, error && `${id}-error`);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className={cx(styles.textarea, error && styles.inputInvalid)}
        rows={rows}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className={styles.fieldError} id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function formatDate(value: string | null): string {
  if (!value) return "Not supplied";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Today in the YYYY-MM-DD form the API's date fields require. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
