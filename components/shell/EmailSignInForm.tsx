"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, ClientApiError } from "@/lib/client/api";
import type { DemoRole } from "@/lib/contracts";
import { ConsentStep } from "./ConsentStep";
import { destinationFor, safeNext } from "./entry-flow";
import { failureKind, formatWait, retryAfterSeconds } from "./errors";
import { StateBlock } from "./states";
import styles from "./EntryForm.module.css";

/**
 * Email sign-in (phase two C.1, docs/FOODPROOF_TECHNICAL_SPEC.md §2 "Phase
 * two C.1", FOODPROOF_API_DETAILS.md). An additional path beside invitation
 * entry, shown only when the server reports it enabled (see `app/pilot/page.tsx`
 * — a server component reads `serverEnvStatus().email_sign_in` directly, so
 * this form never has to probe the endpoints to discover availability).
 *
 * Two steps: send a code, then enter it. A successful verification returns the
 * same `{ label, role, expires_at }` shape invitation entry does, so it shares
 * the analytics-consent step with it (`ConsentStep`).
 *
 * Every sign-in failure is one generic message on purpose
 * (FOODPROOF_API_DETAILS.md): a wrong code, an expired code, an unconfirmed
 * account and an address that does not match the code are indistinguishable.
 * The 60-second resend wait below is a client-side courtesy so a person is not
 * left guessing whether their tap registered; it does not relax the server's
 * own attempt limit.
 */

const RESEND_COOLDOWN_SECONDS = 60;

type Phase = "email" | "code" | "consent";

interface Failure {
  kind: "generic" | "unavailable" | "rate_limited" | "forbidden";
  message: string;
}

function normalisedEmail(value: string): string {
  return value.trim();
}

/**
 * Client-side shape check only, matching the input's own `type="email"`
 * pattern — the server (`SignInEmail` in lib/contracts/requests.ts) is the
 * authority and re-validates regardless.
 */
function isValidEmailShape(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function EmailSignInForm() {
  const searchParams = useSearchParams();
  const emailFieldId = useId();
  const emailErrorId = useId();
  const codeFieldId = useId();
  const codeErrorId = useId();
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailFieldError, setEmailFieldError] = useState<string | null>(null);
  const [codeFieldError, setCodeFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [role, setRole] = useState<DemoRole | null>(null);
  const [resendDeadline, setResendDeadline] = useState<number | null>(null);
  const [resendSecondsLeft, setResendSecondsLeft] = useState(0);

  const requestedNext = safeNext(searchParams.get("next"));

  // Ticks the resend countdown from a fixed deadline (not a per-tick
  // decrement), so it reads correctly no matter how many intermediate ticks
  // actually run.
  useEffect(() => {
    if (resendDeadline == null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
      setResendSecondsLeft(remaining);
      if (remaining <= 0) setResendDeadline(null);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [resendDeadline]);

  function startResendCooldown(): void {
    setResendDeadline(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  }

  function describeSendFailure(error: unknown): Failure {
    switch (failureKind(error)) {
      case "rate_limited":
        return {
          kind: "rate_limited",
          message: `Too many sign-in attempts from this connection. ${formatWait(
            retryAfterSeconds(error),
          )}`,
        };
      case "unavailable":
        return {
          kind: "unavailable",
          message:
            error instanceof ClientApiError && error.message
              ? error.message
              : "Could not send a sign-in code right now. Please try again shortly.",
        };
      default:
        return {
          kind: "generic",
          message: "Could not send a sign-in code right now. Please try again shortly.",
        };
    }
  }

  function describeVerifyFailure(error: unknown): Failure {
    switch (failureKind(error)) {
      case "rate_limited":
        return {
          kind: "rate_limited",
          message: `Too many sign-in attempts from this connection. ${formatWait(
            retryAfterSeconds(error),
          )}`,
        };
      case "forbidden":
        return { kind: "forbidden", message: "This account cannot sign in." };
      case "unavailable":
        return {
          kind: "unavailable",
          message:
            error instanceof ClientApiError && error.message
              ? error.message
              : "Email sign-in is not available right now. Please try again shortly.",
        };
      default:
        // Wrong, expired and unconfirmed all produce this one message.
        return {
          kind: "generic",
          message: "That code is not valid. Request a new code and try again.",
        };
    }
  }

  async function sendCode(address: string): Promise<boolean> {
    setBusy(true);
    try {
      await api.auth.email.request(address);
      return true;
    } catch (error) {
      const described = describeSendFailure(error);
      setFailure(described);
      if (error instanceof ClientApiError && error.code === "VALIDATION_FAILED") {
        setEmailFieldError("Enter a valid email address.");
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setEmailFieldError(null);

    const value = normalisedEmail(email);
    if (!value) {
      setEmailFieldError("Enter your email address.");
      emailInputRef.current?.focus();
      return;
    }
    if (!isValidEmailShape(value)) {
      setEmailFieldError("Enter a valid email address.");
      emailInputRef.current?.focus();
      return;
    }

    const sent = await sendCode(value);
    if (sent) {
      setEmail(value);
      startResendCooldown();
      setPhase("code");
    } else {
      emailInputRef.current?.focus();
    }
  }

  async function handleResend() {
    if (resendSecondsLeft > 0 || busy) return;
    setFailure(null);
    const sent = await sendCode(email);
    if (sent) startResendCooldown();
  }

  function handleUseDifferentAddress() {
    setPhase("email");
    setCode("");
    setCodeFieldError(null);
    setFailure(null);
    setResendDeadline(null);
    setResendSecondsLeft(0);
  }

  async function handleSubmitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    setCodeFieldError(null);

    const value = code.trim();
    if (!/^\d{6,8}$/.test(value)) {
      setCodeFieldError("Enter the 6 to 8 digit code from your email.");
      codeInputRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const session = await api.auth.email.verify(email, value);
      setCode("");
      setRole(session.role);
      setPhase("consent");
    } catch (error) {
      const described = describeVerifyFailure(error);
      setFailure(described);
      if (error instanceof ClientApiError && error.code === "VALIDATION_FAILED") {
        setCodeFieldError("Enter the 6 to 8 digit code from your email.");
      }
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
        title="Email sign-in is unavailable"
        role="alert"
        actions={
          <button type="button" className="btn-primary" onClick={() => setFailure(null)}>
            Try again
          </button>
        }
      >
        <p>{failure.message}</p>
      </StateBlock>
    );
  }

  if (phase === "code") {
    const codeError = codeFieldError ?? failure?.message ?? null;
    return (
      <form className={styles.panel} onSubmit={handleSubmitCode} noValidate>
        <p className={styles.help}>
          We sent a code to <strong>{email}</strong>.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={codeFieldId}>
            One-time code
          </label>
          <input
            id={codeFieldId}
            className={codeError ? `${styles.input} ${styles.inputInvalid}` : styles.input}
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            maxLength={8}
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
            aria-invalid={codeError ? true : undefined}
            aria-describedby={codeError ? codeErrorId : undefined}
          />
          {codeError ? (
            <p id={codeErrorId} className={styles.error} role="alert">
              {codeError}
            </p>
          ) : null}
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Checking…" : "Sign in"}
        </button>

        <p className={styles.help}>
          <button type="button" className={styles.reveal} onClick={handleUseDifferentAddress}>
            Use a different address
          </button>
        </p>
        <p className={styles.help}>
          <button
            type="button"
            className={styles.reveal}
            onClick={handleResend}
            disabled={resendSecondsLeft > 0 || busy}
          >
            Send a new code
          </button>{" "}
          <span aria-live="polite">
            {resendSecondsLeft > 0 ? `Wait ${resendSecondsLeft}s to request another code.` : ""}
          </span>
        </p>
      </form>
    );
  }

  const emailError = emailFieldError ?? failure?.message ?? null;
  return (
    <form className={styles.panel} onSubmit={handleSubmitEmail} noValidate>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={emailFieldId}>
          Email address
        </label>
        <input
          id={emailFieldId}
          className={emailError ? `${styles.input} ${styles.inputInvalid}` : styles.input}
          ref={emailInputRef}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? emailErrorId : undefined}
        />
        {emailError ? (
          <p id={emailErrorId} className={styles.error} role="alert">
            {emailError}
          </p>
        ) : null}
      </div>

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Send code"}
      </button>

      <p className={styles.help}>
        If the code does not arrive within a minute, check the address and try again.
      </p>
    </form>
  );
}
