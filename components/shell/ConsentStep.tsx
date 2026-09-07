"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { clientAnalytics, setClientAnalyticsConsent } from "@/lib/analytics";
import type { DemoRole } from "@/lib/contracts";
import { entryRole } from "./entry-flow";
import { InlineNote } from "./states";
import styles from "./EntryForm.module.css";

/**
 * The post-entry analytics-consent question (docs/FOODPROOF_SCREENS.md §2),
 * shared by invitation entry and email sign-in (phase two C.1) so both paths
 * ask the same question, in the same words, and emit `demo_entered` the same
 * way. Consent is asked AFTER the session exists, because the consent route
 * needs one. Allow and decline are equally available choices; declining is a
 * real answer that is recorded, not a dismissal.
 */
export function ConsentStep({ role, destination }: { role: DemoRole; destination: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  async function handleConsent(allowed: boolean) {
    setConsentError(null);
    setBusy(true);
    try {
      await api.me.setAnalyticsConsent(allowed);
      // This screen sits outside the session provider, so it is the one place
      // that has to tell the analytics adapter the answer itself. Recorded
      // whichever way it went: declining must gate the adapter too.
      setClientAnalyticsConsent(allowed);
      if (allowed) {
        // Only emitted for a consented session, and only with the one
        // allowlisted property for this event — the same event and mapping
        // regardless of which entry path produced the session.
        clientAnalytics.track("demo_entered", { entry_role: entryRole(role) });
      }
      router.push(destination);
    } catch {
      setConsentError(
        "Couldn't record that choice. Nothing is being collected. Try again, or continue — you can set this at any time from the pilot header.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="consent-heading">
      <h2 id="consent-heading" className={styles.heading}>
        Usage analytics
      </h2>
      <p>
        FoodProof can record which screens and actions you use, to improve this demo.
        It never records report contents, evidence, search text, your invitation code
        or your email address.
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
          {consentError} <Link href={destination}>Continue to the pilot</Link>
        </InlineNote>
      ) : null}
    </section>
  );
}
