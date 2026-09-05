"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import { api, ClientApiError } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import type { DemoRole } from "@/lib/contracts";
import { failureKind, formatWait, retryAfterSeconds } from "./errors";
import { InlineNote, StateBlock } from "./states";
import styles from "./EntryForm.module.css";

/**
 * Invitation entry (docs/FOODPROOF_SCREENS.md §2).
 *
 * Phase one has no login: a masked invitation code is exchanged for a demo
 * session, and the invitation alone decides the role. There is deliberately no
 * email/password form, no OTP, no provider button, no "authenticated" wording
 * and no reviewer toggle.
 *
 * Failure copy is generic on purpose: an unknown, expired and revoked code all
 * produce the same message, so this screen cannot be used to test which codes
 * exist. Rate limiting shows the wait the server asked for, and an unreachable
 * backend is stated explicitly instead of falling back to local demo data.
 *
 * Analytics consent is asked AFTER the session exists, because the consent
 * route needs it. Allow and decline are equally available choices; declining is
 * a real answer that is recorded, not a dismissal.
 */

type Phase = "code" | "consent";

interface Failure {
  kind: "generic" | "unavailable" | "rate_limited";
  message: string;
}

function entryRole(role: DemoRole): "reporter" | "reviewer" {
  return role === "reviewer" ? "reviewer" : "reporter";
}

/** Only ever follow a `next` that stays inside the pilot section. */
function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/pilot/") ? raw : null;
}

export function EntryForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const codeFieldId = useId();
  const codeErrorId = useId();

  const [phase, setPhase] = useState<Phase>("code");
  const [code, setCode] = useState("");
  const [revealCode, setRevealCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [role, setRole] = useState<DemoRole | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);

  const requestedNext = safeNext(searchParams.get("next"));

  function destinationFor(sessionRole: DemoRole): string {
    if (requestedNext) return requestedNext;
    return sessionRole === "reviewer" ? "/pilot/review" : "/pilot/feed";
  }

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
      setFailure(describeFailure(error));
      if (error instanceof ClientApiError && error.code === "VALIDATION_FAILED") {
        setFieldError("Enter the invitation code you were sent.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConsent(allowed: boolean) {
    if (!role) return;
    setConsentError(null);
    setBusy(true);
    try {
      await api.me.setAnalyticsConsent(allowed);
      if (allowed) {
        // Only emitted for a consented session, and only with the one
        // allowlisted property for this event.
        clientAnalytics.track("demo_entered", { entry_role: entryRole(role) });
      }
      router.push(destinationFor(role));
    } catch {
      setConsentError(
        "Couldn't record that choice. Nothing is being collected. Try again, or continue — you can set this at any time from the pilot header.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (phase === "consent" && role) {
    return (
      <section className={styles.panel} aria-labelledby="consent-heading">
        <h2 id="consent-heading" className={styles.heading}>
          Usage analytics
        </h2>
        <p>
          FoodProof can record which screens and actions you use, to improve this demo.
          It never records report contents, evidence, search text or your invitation code.
        </p>
        <p className="muted">
          Both choices give you exactly the same pilot. You can change this later from the
          pilot header.
        </p>
        <div className={styles.consentChoices}>
          <button
            type="button"
            className={styles.choiceButton}
            onClick={() => handleConsent(true)}
            disabled={busy}
          >
            Allow usage analytics
          </button>
          <button
            type="button"
            className={styles.choiceButton}
            onClick={() => handleConsent(false)}
            disabled={busy}
          >
            Continue without analytics
          </button>
        </div>
        {consentError ? (
          <InlineNote tone="error" role="alert">
            {consentError}{" "}
            <Link href={destinationFor(role)}>Continue to the pilot</Link>
          </InlineNote>
        ) : null}
      </section>
    );
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
            className={styles.input}
            type={revealCode ? "text" : "password"}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            aria-invalid={fieldError ? true : undefined}
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
