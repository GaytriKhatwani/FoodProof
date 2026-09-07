"use client";

import { useSearchParams } from "next/navigation";
import { useId, useRef, useState } from "react";
import { api, ClientApiError } from "@/lib/client/api";
import type { DemoRole } from "@/lib/contracts";
import { ConsentStep } from "./ConsentStep";
import { destinationFor, safeNext } from "./entry-flow";
import { failureKind, formatWait, retryAfterSeconds } from "./errors";
import { StateBlock } from "./states";
import styles from "./EntryForm.module.css";

/**
 * Invitation entry (docs/FOODPROOF_SCREENS.md §2).
 *
 * Phase one has no login: a masked invitation code is exchanged for a demo
 * session, and the invitation alone decides the role. There is deliberately no
 * email/password form, no OTP, no provider button, no "authenticated" wording
 * and no reviewer toggle. Phase two C.1 adds a separate, additional email
 * sign-in path (`EmailSignInForm`) beside this one; this form and its failure
 * copy are unchanged by that addition.
 *
 * Failure copy is generic on purpose: an unknown, expired and revoked code all
 * produce the same message, so this screen cannot be used to test which codes
 * exist. Rate limiting shows the wait the server asked for, and an unreachable
 * backend is stated explicitly instead of falling back to local demo data.
 *
 * The post-entry analytics-consent step is shared with email sign-in — see
 * `ConsentStep` — so both paths ask the same question and emit `demo_entered`
 * the same way.
 */

type Phase = "code" | "consent";

interface Failure {
  kind: "generic" | "unavailable" | "rate_limited";
  message: string;
}

export function EntryForm({ demoCode = null }: { demoCode?: string | null }) {
  const searchParams = useSearchParams();
  const codeFieldId = useId();
  const codeErrorId = useId();
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<Phase>("code");
  const [code, setCode] = useState("");
  const [revealCode, setRevealCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [role, setRole] = useState<DemoRole | null>(null);

  const requestedNext = safeNext(searchParams.get("next"));

  function describeFailure(error: unknown): Failure {
    switch (failureKind(error)) {
      case "unavailable":
        return {
          kind: "unavailable",
          message:
            "The pilot could not reach its demo service. Nothing was signed in, and this demo has no offline copy to fall back on.",
        };
      case "rate_limited":
        return {
          kind: "rate_limited",
          message: `Too many invitation attempts from this connection. ${formatWait(
            retryAfterSeconds(error),
          )}`,
        };
      default:
        // Unknown, expired and revoked codes are deliberately indistinguishable.
        return {
          kind: "generic",
          message:
            "That invitation code was not accepted. Check the code exactly as it was sent to you and try again.",
        };
    }
  }

  async function handleSubmitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setFieldError(null);

    const value = code.trim();
    if (!value) {
      setFieldError("Enter the invitation code you were sent.");
      // Put the caret back on the one thing that has to change.
      codeInputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const session = await api.session.create(value);
      // The raw code is not needed again; drop it from component state.
      setCode("");
      setRevealCode(false);
      setRole(session.role);
      setPhase("consent");
    } catch (error) {
      const described = describeFailure(error);
      setFailure(described);
      if (error instanceof ClientApiError && error.code === "VALIDATION_FAILED") {
        setFieldError("Enter the invitation code you were sent.");
      }
      // A refused code is corrected in the field, so focus goes back to it. An
      // unreachable backend replaces this form with its own state block, and
      // must not have focus pulled out from under it.
      if (described.kind !== "unavailable") codeInputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (phase === "consent" && role) {
    return <ConsentStep role={role} destination={destinationFor(role, requestedNext)} />;
  }

  if (failure?.kind === "unavailable") {
    return (
      <StateBlock
        tone="error"
        title="The demo backend is unavailable"
        role="alert"
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setFailure(null)}
          >
            Try again
          </button>
        }
      >
        <p>{failure.message}</p>
      </StateBlock>
    );
  }

  return (
    <form className={styles.panel} onSubmit={handleSubmitCode} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={codeFieldId}>
          Invitation code
        </label>
        <div className={styles.codeRow}>
          <input
            id={codeFieldId}
            className={
              fieldError || failure ? `${styles.input} ${styles.inputInvalid}` : styles.input
            }
            ref={codeInputRef}
            type={revealCode ? "text" : "password"}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            aria-invalid={fieldError || failure ? true : undefined}
            aria-describedby={fieldError || failure ? codeErrorId : undefined}
          />
          <button
            type="button"
            className={styles.reveal}
            onClick={() => setRevealCode((shown) => !shown)}
            aria-pressed={revealCode}
          >
            {revealCode ? "Hide code" : "Show code"}
          </button>
        </div>
        {fieldError || failure ? (
          <p id={codeErrorId} className={styles.error} role="alert">
            {fieldError ?? failure?.message}
          </p>
        ) : null}
        {demoCode ? (
          // Published by the owner through DEMO_PUBLIC_USER_CODE, so anyone can
          // walk the demo as a user without asking for a code. Rendered only
          // when the deployment sets it; the field still has to be submitted.
          <div className={styles.demoCode}>
            <div className={styles.demoCodeRow}>
              <span>
                Just looking? The shared demo user code is <code>{demoCode}</code>
              </span>
              <button
                type="button"
                className={styles.reveal}
                onClick={() => {
                  setCode(demoCode);
                  setRevealCode(true);
                  setFieldError(null);
                  setFailure(null);
                  codeInputRef.current?.focus();
                }}
              >
                Use the demo code
              </button>
            </div>
            <p className={styles.demoCodeNote}>
              Everyone who uses this shared code enters the <strong>same</strong>{" "}
              demo account. Anything you record with it can be seen, edited and
              withdrawn by other people using the code, and their records appear
              in your list. Use fictional details only.
            </p>
          </div>
        ) : null}
      </div>

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Checking…" : "Enter demo"}
      </button>

      <p className={styles.help}>
        Your invitation determines the experience: a demo user enters the community feed,
        a demo reviewer enters the review queue. There is no way to change role here.
      </p>
      <p className={styles.help}>
        If your code does not work, ask for a new one through the same channel the
        invitation came from.
      </p>
    </form>
  );
}
