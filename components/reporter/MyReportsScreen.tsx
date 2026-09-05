"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportSummary } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { toFailure, trackFlowError, type Failure } from "./failure";
import {
  DemoDataNote,
  FailureNotice,
  LIFECYCLE_LABEL,
  Loading,
  PREPARATION_LABEL,
  VISIBILITY_LABEL,
  formatDateTime,
} from "./ui";
import styles from "./reporter.module.css";

/**
 * My reports — `/pilot/reports` (docs/FOODPROOF_SCREENS.md §8).
 * Own reports only; the API resolves ownership from the demo session, so this
 * screen never asks for a user id. Each row shows the three separate status
 * dimensions with their honest labels — preparation is an internal readiness
 * threshold, community visibility is moderation state, and follow-up is the
 * reporter's own. None of them means filed, delivered or safe.
 */
export function MyReportsScreen() {
  const [items, setItems] = useState<ReportSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const reported = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const page = await api.reports.list();
      setItems(page.items);
      setCursor(page.next_cursor);
      setFailure(null);
      setStatus("ready");
      reported.current = false;
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      setStatus("failed");
      if (!reported.current) {
        trackFlowError("load", next);
        reported.current = true;
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api.reports.list(cursor);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
      setFailure(null);
    } catch (error) {
      const next = toFailure(error);
      setFailure(next);
      trackFlowError("load", next);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor]);

  return (
    <section className={styles.screen} aria-labelledby="my-reports-title">
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="my-reports-title">
            My reports
          </h1>
          <p className={styles.lede}>
            Every report starts private. Sharing with the community and sending a
            complaint outside FoodProof are separate, deliberate steps.
          </p>
        </div>
        <Link className="btn-primary" href="/pilot/reports/new">
          Start a report
        </Link>
      </div>

      <DemoDataNote />

      {status === "loading" ? <Loading what="your reports" /> : null}

      {status === "failed" && failure ? (
        <FailureNotice failure={failure} onRetry={() => void load()} />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <div className={styles.panel}>
          <h2 className={styles.subTitle}>No reports yet</h2>
          <p className={styles.small}>
            Nothing has been saved under this invitation. Start a report to
            document a label concern with sample or redacted evidence.
          </p>
          <div className={styles.actions}>
            <Link className="btn-primary" href="/pilot/reports/new">
              Start a report
            </Link>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className={styles.rows}>
            {items.map((item) => (
              <li className={styles.row} key={item.report_id}>
                <div className={styles.rowMain}>
                  <h2 className={styles.rowTitle}>
                    <Link href={`/pilot/reports/${item.report_id}`}>
                      {item.product_name}
                      {item.variant ? ` · ${item.variant}` : ""}
                    </Link>
                  </h2>
                  <p className={styles.small}>
                    {item.brand} · updated {formatDateTime(item.updated_at)}
                  </p>
                  <ul className={styles.chips}>
                    <li className={styles.chip}>
                      <span className={styles.chipLabel}>Preparation</span>{" "}
                      <span className={styles.chipValue}>
                        {PREPARATION_LABEL[item.preparation]}
                      </span>
                    </li>
                    <li className={styles.chip}>
                      <span className={styles.chipLabel}>Community</span>{" "}
                      <span className={styles.chipValue}>
                        {VISIBILITY_LABEL[item.community_visibility]}
                      </span>
                    </li>
                    <li className={styles.chip}>
                      <span className={styles.chipLabel}>Follow-up</span>{" "}
                      <span className={styles.chipValue}>
                        {LIFECYCLE_LABEL[item.lifecycle]}
                      </span>
                    </li>
                  </ul>
                </div>
                <div className={styles.actions}>
                  <Link
                    className={styles.btnSecondary}
                    href={`/pilot/reports/${item.report_id}`}
                  >
                    Open record
                  </Link>
                  <Link
                    className={styles.btnQuiet}
                    href={`/pilot/reports/${item.report_id}/edit`}
                  >
                    Edit
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {cursor ? (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Show older reports"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <p className={styles.footnote}>
        “Ready” means this record has the facts and label photos the pilot needs
        before you can request a community review. It does not mean a complaint
        was filed, delivered, or that a product is safe.
      </p>
    </section>
  );
}
