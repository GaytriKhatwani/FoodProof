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
 *
 * The identity shown here (phase two C.1) reads `me.sign_in_method`: a
 * verified account shows its email and "Signed in with email"; an invitation
 * actor keeps the existing demo label and "Test identity" wording. Either
 * way the reviewer nav link and every server-enforced check still derive from
 * `me.role` alone, never from `sign_in_method`.
 *
 * Composition: one ruled band read left to right as brand → navigation →
 * session. DOM order is that order at EVERY width, because a wrapped header
 * once put navigation visually last while Tab still reached it first
 * (docs/FOODPROOF_UI_AUDIT.md A8). Below 900px the band becomes stacked rows
 * in the same sequence, and neither "Exit demo" nor the analytics preference
 * is ever hidden behind a disclosure.
 */

interface NavItem {
  href: string;
  label: string;
  /** True when this item represents the page currently open. */
  match: (pathname: string) => boolean;
  /** The one create action in the navigation; rendered as a filled control. */
  action?: boolean;
}

/**
 * `/pilot/reports/new` is the reporter's entry point and `/pilot/reports/*`
 * is the reporter's own record list (T2). They share a path prefix, so
 * "Raise a concern" matches its exact path only and "My reports" claims every
 * other `/pilot/reports` route — a plain prefix test would light both up on
 * the new-report screen.
 */
const RAISE_HREF = "/pilot/reports/new";

const BASE_NAV: NavItem[] = [
  {
    href: "/pilot/feed",
    label: "Feed",
    match: (pathname) => pathname === "/pilot/feed" || pathname.startsWith("/pilot/feed/"),
  },
  {
    href: RAISE_HREF,
    label: "Raise a concern",
    match: (pathname) => pathname === RAISE_HREF,
    action: true,
  },
  {
    href: "/pilot/reports",
    label: "My reports",
    match: (pathname) =>
      pathname !== RAISE_HREF &&
      (pathname === "/pilot/reports" || pathname.startsWith("/pilot/reports/")),
  },
];

const REVIEW_NAV: NavItem = {
  href: "/pilot/review",
  label: "Review",
  match: (pathname) => pathname === "/pilot/review" || pathname.startsWith("/pilot/review/"),
};

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
      // `setAnalyticsConsent` writes the choice and refreshes `me`, so the
      // control below re-renders from the server's own value.
      await setAnalyticsConsent(next);
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
    body = <LoadingBlock label="Ending the demo session…" shape="page" />;
  } else if (status === "loading") {
    body = <LoadingBlock label="Loading your pilot session…" shape="page" />;
  } else if (status === "anonymous") {
    body = (
      <StateBlock
        placement="page"
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
        placement="page"
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
        {/*
          Without a session there is no navigation and no session cluster, so
          the band closes up instead of reserving a row of nothing. While the
          session is still loading it DOES reserve that row, because the header
          must not jump when `/api/me` answers.
        */}
        <div
          className={`container ${styles.headerInner} ${
            status === "ready" || status === "loading" ? "" : styles.headerInnerBare
          }`}
        >
          <div className={styles.brand}>
            <span className="wordmark">
              <strong>Food</strong>Proof
            </span>
            <span className={styles.demoTag}>Demo · sample or redacted data</span>
          </div>

          <nav className={styles.nav} aria-label="Pilot">
            {status === "ready" ? (
              <ul className={styles.navList}>
                {navItems.map((item) => {
                  const current = item.match(pathname);
                  const classes = [styles.navLink];
                  if (item.action) classes.push(styles.navAction);
                  if (current) classes.push(styles.navLinkCurrent);
                  return (
                    <li key={item.href} className={styles.navItem}>
                      <Link
                        href={item.href}
                        className={classes.join(" ")}
                        aria-current={current ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : status === "loading" ? (
              <span className={styles.navPlaceholder} aria-hidden="true" />
            ) : null}
          </nav>

          <div className={styles.session}>
            {status === "ready" && me ? (
              <>
                {/*
                  Both two-line session units read marker-above-value, so the
                  cluster sits on one baseline grid instead of the three
                  competing ones the loose clusters produced.
                */}
                <span className={styles.identity}>
                  {me.sign_in_method === "email" ? (
                    <>
                      <span className={styles.identityMarker}>Signed in with email</span>
                      <span className={styles.identityLabel}>{me.email ?? me.label}</span>
                    </>
                  ) : (
                    <>
                      <span className={styles.identityMarker}>
                        Test identity · not an email account
                      </span>
                      <span className={styles.identityLabel}>{me.label}</span>
                    </>
                  )}
                </span>

                <AnalyticsPreference
                  allowed={me.analytics_consent}
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
            ) : status === "loading" ? (
              <span className={styles.sessionPlaceholder} aria-hidden="true" />
            ) : null}
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
