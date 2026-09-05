"use client";

import { useId, useState } from "react";
import { api } from "@/lib/client/api";
import { failureKind } from "@/components/shell/errors";
import { trackFlowError } from "@/components/shell/flow-error";
import { InlineNote, StateBlock } from "@/components/shell/states";
import { useActionKey } from "@/components/shell/useActionKey";
import styles from "./FlagForm.module.css";

/**
 * Private correction / removal request on a published concern
 * (docs/FOODPROOF_SCREENS.md §4).
 *
 * This is a moderation signal to the reviewer, not a public comment: nothing
 * typed here appears on the concern, and the confirmation promises no response
 * time, because there is no service commitment behind it.
 */
export function FlagForm({ reportId }: { reportId: string }) {
  const reasonId = useId();
  const detailId = useId();
  const regionId = useId();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [keyFor, resetKey] = useActionKey();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    setSubmitError(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setFieldError("Describe what should be corrected or reviewed.");
      return;
    }
    const trimmedDetail = detail.trim();

    setBusy(true);
    try {
      await api.feed.flag(
        reportId,
        trimmedDetail ? { reason: trimmedReason, detail: trimmedDetail } : { reason: trimmedReason },
        // Retrying the same text replays the original result instead of filing
        // a second request; changed text is a new request.
        keyFor(`${trimmedReason} ${trimmedDetail}`),
      );
      resetKey();
      setSubmitted(true);
      setOpen(false);
      // Values are cleared only after a confirmed success.
      setReason("");
      setDetail("");
    } catch (error) {
      trackFlowError("save", error);
      switch (failureKind(error)) {
        case "not_found":
          setSubmitError(
            "This concern is no longer visible in the community feed, so it cannot be flagged.",
          );
          break;
        case "unavailable":
          setSubmitError(
            "The demo service could not be reached, so nothing was submitted. Your text is still here — try again.",
          );
          break;
        case "validation":
          setSubmitError("That request could not be submitted. Check the reason and try again.");
          break;
        default:
          setSubmitError("That request could not be submitted. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <StateBlock
        title="Request recorded for review"
        headingLevel="h3"
        role="status"
        actions={
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              setSubmitted(false);
              setOpen(true);
            }}
          >
            Send another request
          </button>
        }
      >
        <p>
          Your request is private: it goes to the reviewer only and is never shown on this
          concern or to its reporter as your message. No response time is promised, and you
          will not receive a reply through this demo.
        </p>
      </StateBlock>
    );
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.secondaryButton}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((current) => !current)}
      >
        Flag a concern or request a correction
      </button>

      <div id={regionId} hidden={!open}>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <p className={styles.help}>
            Use this to tell the reviewer that something here is wrong, unfair, or exposes
            private information. It is not a public reply.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={reasonId}>
              Reason (required)
            </label>
            <textarea
              id={reasonId}
              className={styles.textarea}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? `${reasonId}-error` : undefined}
            />
            {fieldError ? (
              <p id={`${reasonId}-error`} className={styles.error} role="alert">
                {fieldError}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={detailId}>
              More detail (optional)
            </label>
            <textarea
              id={detailId}
              className={styles.textarea}
              rows={3}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Sending…" : "Send request to the reviewer"}
          </button>

          {submitError ? (
            <InlineNote tone="error" role="alert">
              {submitError}
            </InlineNote>
          ) : null}
        </form>
      </div>
    </div>
  );
}
