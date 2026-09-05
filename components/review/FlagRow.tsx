"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { api, type ReviewQueueFlag } from "@/lib/client/api";
import { failureKind } from "@/components/shell/errors";
import { formatDateOr } from "@/components/shell/format";
import { InlineNote } from "@/components/shell/states";
import { useActionKey } from "@/components/shell/useActionKey";
import styles from "./ReviewQueue.module.css";

/**
 * One open correction request in the reviewer queue
 * (docs/FOODPROOF_SCREENS.md §10).
 *
 * Both outcomes require a written reason: keeping the concern visible records
 * why, and removing it records why and hides it from the community. Removal
 * never destroys the reporter's private record, evidence or history — it is a
 * visibility decision, taken in one transaction with the flag resolution.
 */
export function FlagRow({
  flag,
  onHandled,
}: {
  flag: ReviewQueueFlag;
  onHandled: (flagId: string) => void;
}) {
  const noteId = useId();
  const regionId = useId();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"keep" | "remove" | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [keyFor, resetKey] = useActionKey();

  async function resolve(remove: boolean) {
    setFieldError(null);
    setSubmitError(null);

    const reason = note.trim();
    if (!reason) {
      setFieldError("Record the reason for this decision before continuing.");
      return;
    }

    setBusy(remove ? "remove" : "keep");
    try {
      await api.review.resolveFlag(
        flag.id,
        { note: reason, remove },
        keyFor(`${remove ? "remove" : "keep"}:${reason}`),
      );
      resetKey();
      onHandled(flag.id);
    } catch (error) {
      switch (failureKind(error)) {
        case "not_found":
          setSubmitError("This flag is no longer open. Refresh the queue.");
          break;
        case "forbidden":
          setSubmitError("Reviewer access is required for this action.");
          break;
        case "unavailable":
          setSubmitError(
            "The demo service could not be reached, so nothing was recorded. Your reason is still here — try again.",
          );
          break;
        default:
          setSubmitError("That decision could not be recorded. Try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className={styles.item}>
      <div className={styles.itemMain}>
        <h3 className={styles.itemTitle}>Correction request</h3>
        <p className={styles.itemMeta}>Raised {formatDateOr(flag.created_at)}</p>
        <p className={styles.flagReason}>{flag.reason}</p>
        <p className={styles.itemMeta}>
          <Link href={`/pilot/concerns/${flag.report_id}`}>Open the published concern</Link>
        </p>

        <button
          type="button"
          className={styles.linkButton}
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? "Cancel" : "Handle this request"}
        </button>

        <div id={regionId} hidden={!open}>
          <label className={styles.label} htmlFor={noteId}>
            Review reason (required)
          </label>
          <textarea
            id={noteId}
            className={styles.textarea}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${noteId}-error` : undefined}
          />
          {fieldError ? (
            <p id={`${noteId}-error`} className={styles.error} role="alert">
              {fieldError}
            </p>
          ) : null}

          <div className={styles.flagActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void resolve(false)}
              disabled={busy !== null}
            >
              {busy === "keep" ? "Recording…" : "Keep visible and record this reason"}
            </button>
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => void resolve(true)}
              disabled={busy !== null}
            >
              {busy === "remove" ? "Removing…" : "Remove from the community"}
            </button>
          </div>

          <p className={styles.itemMeta}>
            Removal hides the concern and cancels anything still awaiting approval for it.
            The reporter&rsquo;s private report, evidence and history are kept.
          </p>

          {submitError ? (
            <InlineNote tone="error" role="alert">
              {submitError}
            </InlineNote>
          ) : null}
        </div>
      </div>
    </li>
  );
}
