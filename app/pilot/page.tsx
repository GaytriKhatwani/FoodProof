import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { EmailSignInForm } from "@/components/shell/EmailSignInForm";
import { EntryForm } from "@/components/shell/EntryForm";
import { SkipLink } from "@/components/shell/SkipLink";
import { LoadingBlock } from "@/components/shell/states";
import { serverEnvStatus } from "@/lib/server/env";
import styles from "@/components/shell/EntryPage.module.css";

/**
 * Pilot entry — `/pilot` (docs/FOODPROOF_SCREENS.md §2).
 *
 * This route sits OUTSIDE the `(shell)` route group on purpose: it is the one
 * pilot page a visitor without a session may reach, so it has no session
 * provider, no pilot navigation, and it requests no pilot content. Everything
 * here is static text; the client forms own the invitation exchange, the
 * email sign-in exchange (phase two C.1) and the analytics-consent question.
 *
 * `serverEnvStatus().email_sign_in` is read directly, as a server component:
 * the email path is rendered only when the deployment actually offers it,
 * never discovered by probing `/api/auth/email/*`. With the flag off this
 * page renders exactly as phase one — invitation entry only.
 */
export const metadata: Metadata = {
  title: "Enter the FoodProof pilot",
};

/**
 * The invitation identities notice and its closing footnote, shared by both
 * branches below so the copy exists once in source. `scopedFootnote` names
 * the invitation path specifically once email sign-in is also on the page
 * (that path does create or reuse an account, so the footnote can no longer
 * speak for "entering the demo" in general); with the flag off the sentence
 * is byte-for-byte the phase-one original.
 */
function InvitationNotices({ scopedFootnote }: { scopedFootnote: boolean }) {
  return (
    <>
      <div className={`notice ${styles.identities}`}>
        <p>
          Demo user — <strong>user@foodproof</strong>. Demo reviewer —{" "}
          <strong>reviewer@foodproof</strong>. These are test labels, not email
          accounts, and they are not verified identities.
        </p>
      </div>

      <p className={`muted ${styles.footnote}`}>
        {scopedFootnote
          ? "Entering the demo with an invitation code does not file anything, does not contact any brand or authority, and does not create an account."
          : "Entering the demo does not file anything, does not contact any brand or authority, and does not create an account."}
      </p>
    </>
  );
}

export default function PilotEntryPage() {
  const emailSignIn = serverEnvStatus().email_sign_in;

  return (
    <>
      <SkipLink />
      <header className="site-header container">
        <span className="wordmark">
          <strong>Food</strong>Proof
        </span>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/">Back to the introduction</Link>
        </nav>
      </header>

      <main id="main" className={`container ${styles.main}`}>
        <section className={styles.intro}>
          <h1 className={styles.title}>FoodProof pilot</h1>
          <p className={styles.lede}>
            This is an invited demo. It uses sample or redacted information and simulated
            roles. Do not enter personal evidence, real complaint text, or anything you
            would not want a reviewer to read.
          </p>

          {emailSignIn ? (
            <>
              <div className={styles.pathSection}>
                <h2 className={styles.pathHeading}>Sign in with your email</h2>
                <p className={styles.pathIntro}>
                  Get a one-time code by email. Signing in creates or reuses an account
                  tied to that address, and it does not connect to any demo reports.
                </p>
                <Suspense fallback={<LoadingBlock label="Loading email sign-in…" lines={2} />}>
                  <EmailSignInForm />
                </Suspense>
              </div>

              <div className={styles.pathSection}>
                <h2 className={styles.pathHeading}>Have an invitation code?</h2>
                <p className={styles.pathIntro}>
                  Enter the code you were sent. It decides your role for this demo.
                </p>
                <Suspense fallback={<LoadingBlock label="Loading the entry form…" lines={2} />}>
                  <EntryForm />
                </Suspense>

                <InvitationNotices scopedFootnote />
              </div>
            </>
          ) : (
            <>
              <Suspense fallback={<LoadingBlock label="Loading the entry form…" lines={2} />}>
                <EntryForm />
              </Suspense>

              <InvitationNotices scopedFootnote={false} />
            </>
          )}
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            FoodProof is an independent project, not affiliated with any
            government agency.
          </p>
        </div>
      </footer>
    </>
  );
}
