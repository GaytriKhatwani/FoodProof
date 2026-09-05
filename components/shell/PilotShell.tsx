"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useSession } from "@/lib/client/session";
import { SkipLink } from "./SkipLink";
import { LoadingBlock, StateBlock } from "./states";
import styles from "./PilotShell.module.css";

/**
 * The pilot shell (docs/FOODPROOF_SCREENS.md "Shared interaction contract").
 *
 * Wraps every `/pilot/*` page except the `/pilot` entry screen. It owns the
 * single header, navigation and `<main id="main">` landmark for the whole pilot
 * — pages rendered inside must not add their own.
 *
 * Role comes only from `GET /api/me`; there is no client-side role switch
 * anywhere in this interface, and the Review link simply does not exist for a
 * non-reviewer invitation (the API refuses the route regardless). When the
 * session is missing or the backend cannot be reached, children are NOT
 * rendered and the shell says so explicitly — it never substitutes local data.
 */

interface NavItem {
  href: string;
  label: string;
}

/** `/pilot/reports` and `/pilot/reports/new` are the reporter routes (T2). */
const BASE_NAV: NavItem[] = [
  { href: "/pilot/feed", label: "Feed" },
  { href: "/pilot/reports", label: "My reports" },
];

const REVIEW_NAV: NavItem = { href: "/pilot/review", label: "Review" };

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Persistent control to allow or withdraw usage analytics. Both directions are
 * one click away from every pilot screen, and the current state is announced.
 */
function AnalyticsPreference({
  allowed,
  busy,
  onChange,
}: {
  allowed: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <span className={styles.consent}>
      <span className={styles.consentState} aria-live="polite">
        Usage analytics: {allowed ? "allowed" : "off"}
      </span>
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => onChange(!allowed)}
        disabled={busy}
      >
        {busy ? "Saving…" : allowed ? "Withdraw consent" : "Allow analytics"}
      </button>
    </span>
  );
}

export function PilotShell({ children }: { children: ReactNode }) {
  const { status, me, refresh, setAnalyticsConsent, exit } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  const [exiting, setExiting] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  /**
   * The value the consent request last confirmed. A 200 from
   * `PUT /api/me/analytics-consent` is authoritative, and it is preferred over
   * `me.analytics_consent` because that read currently lags behind the write —
   * see the stale-read defect reported to the integration owner (every Supabase
   * read inside a route handler is stored in the Next Data Cache). Once that is
   * fixed the two agree and this override is simply redundant.
   */
  const [confirmedConsent, setConfirmedConsent] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);

  const reviewer = me?.role === "reviewer";
  const navItems = reviewer ? [...BASE_NAV, REVIEW_NAV] : BASE_NAV;

  async function handleExit() {
    setExitError(null);
    setExiting(true);
    try {
      await exit();
      router.push("/");
    } catch {
      // Never claim the session ended when the request did not succeed.
      setExiting(false);
      setExitError("Couldn't end the demo session. Check your connection and try again.");
    }
  }

  async function handleConsent(next: boolean) {
    setConsentError(null);
    setConsentBusy(true);
    try {
      await setAnalyticsConsent(next);
      setConfirmedConsent(next);
    } catch {
      setConsentError("Couldn't save that preference. Your previous choice still applies.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function handleRetry() {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }

  const nextParam = pathname.startsWith("/pilot/")
    ? `?next=${encodeURIComponent(pathname)}`
    : "";

  let body: ReactNode;
  if (exiting) {
    body = <LoadingBlock label="Ending the demo session…" lines={2} />;
  } else if (status === "loading") {
    body = <LoadingBlock label="Loading your pilot session…" />;
  } else if (status === "anonymous") {
    body = (
      <StateBlock
        title="Your pilot session has ended"
        headingLevel="h1"
        actions={
          <Link className="btn-primary" href={`/pilot${nextParam}`}>
            Enter with your invitation
          </Link>
        }
      >
        <p>
          Demo sessions expire, and exiting the demo ends one immediately. Enter your
          invitation code again to continue. Nothing you saved was deleted by this.
        </p>
      </StateBlock>
    );
  } else if (status === "unavailable") {
    body = (
      <StateBlock
        tone="error"
        title="The demo backend is unavailable"
        headingLevel="h1"
        role="alert"
        actions={
          <button type="button" className="btn-primary" onClick={handleRetry} disabled={retrying}>
            {retrying ? "Retrying…" : "Retry"}
          </button>
        }
      >
        <p>
          The pilot could not reach its demo service, so no pilot content is shown. This
          demo has no offline copy and will not show stored or example data instead.
        </p>
      </StateBlock>
    );
  } else {
    body = children;
  }

  return (
    <div className={styles.shell}>
      <SkipLink />
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <div className={styles.brandRow}>
            <span className="wordmark">
              <strong>Food</strong>Proof
            </span>
            <span className={styles.demoTag}>Demo · sample or redacted data</span>
          </div>

          <nav className={styles.nav} aria-label="Pilot">
            {status === "ready" ? (
              <ul className={styles.navList}>
                {navItems.map((item) => {
                  const current = isCurrent(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={current ? `${styles.navLink} ${styles.navLinkCurrent}` : styles.navLink}
                        aria-current={current ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className={styles.navPlaceholder} aria-hidden="true" />
            )}
          </nav>

          <div className={styles.session}>
            {status === "ready" && me ? (
              <>
                <span className={styles.identity}>
                  <span className={styles.identityLabel}>{me.label}</span>
                  <span className={styles.identityMarker}>Test identity · not an email account</span>
                </span>

                <AnalyticsPreference
                  allowed={confirmedConsent ?? me.analytics_consent}
                  busy={consentBusy}
                  onChange={handleConsent}
                />

                <button
                  type="button"
                  className={styles.exitButton}
                  onClick={handleExit}
                  disabled={exiting}
                >
                  Exit demo
                </button>
              </>
            ) : (
              <span className={styles.sessionPlaceholder} aria-hidden="true" />
            )}
          </div>
        </div>

        {consentError ? (
          <div className={`container ${styles.headerNotice}`} role="alert">
            {consentError}
          </div>
        ) : null}
        {exitError ? (
          <div className={`container ${styles.headerNotice}`} role="alert">
            {exitError}
          </div>
        ) : null}
      </header>

      <main id="main" className={`container ${styles.main}`}>
        {body}
      </main>
    </div>
  );
}
