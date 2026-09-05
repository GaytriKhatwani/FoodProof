import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { EntryForm } from "@/components/shell/EntryForm";
import { SkipLink } from "@/components/shell/SkipLink";
import { LoadingBlock } from "@/components/shell/states";
import styles from "@/components/shell/EntryPage.module.css";

/**
 * Pilot entry — `/pilot` (docs/FOODPROOF_SCREENS.md §2).
 *
 * This route sits OUTSIDE the `(shell)` route group on purpose: it is the one
 * pilot page a visitor without a session may reach, so it has no session
 * provider, no pilot navigation, and it requests no pilot content. Everything
 * here is static text; the client `EntryForm` owns the invitation exchange and
 * the analytics-consent question.
 */
export const metadata: Metadata = {
  title: "Enter the FoodProof pilot",
};

export default function PilotEntryPage() {
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

          <Suspense fallback={<LoadingBlock label="Loading the entry form…" lines={2} />}>
            <EntryForm />
          </Suspense>

          <div className={`notice ${styles.identities}`}>
            <p>
              Demo user — <strong>user@foodproof</strong>. Demo reviewer —{" "}
              <strong>reviewer@foodproof</strong>. These are test labels, not email
              accounts, and they are not verified identities.
            </p>
          </div>

          <p className={`muted ${styles.footnote}`}>
            Entering the demo does not file anything, does not contact any brand or
            authority, and does not create an account.
          </p>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p>
            FoodProof is an independent project with no government affiliation. It does not
            file complaints, guarantee responses, or look up product safety.
          </p>
        </div>
      </footer>
    </>
  );
}
