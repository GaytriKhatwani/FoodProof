"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportSummary } from "@/lib/contracts";
import { api } from "@/lib/client/api";
import { toFailure, trackFlowError, type Failure } from "./failure";
import {
  DemoDataNote,
  FailureNotice,
  Loading,
  StatusChips,
  formatDateTime,
  nextStepFor,
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

  const empty = status === "ready" && items.length === 0;

  return (
    <section className={styles.screen} aria-labelledby="my-reports-title">
      <div className={styles.head}>
        <div className={styles.headMain}>
          <h1 className={styles.title} id="my-reports-title">
            My reports
          </h1>
          <p className={styles.lede}>
            Where every concern you have raised stands: how ready it is, whether
            the community can see it, and whether you are still following it up.
          </p>
        </div>
        {empty ? null : (
          <Link className="btn-primary" href="/pilot/reports/new">
            Raise a concern
          </Link>
        )}
      </div>

      <DemoDataNote />

      {status === "loading" ? <Loading what="your reports" /> : null}

      {status === "failed" && failure ? (
        <FailureNotice failure={failure} onRetry={() => void load()} />
      ) : null}

      {empty ? (
        <div className={styles.callout}>
          <h2 className={styles.sectionTitle}>Nothing recorded yet</h2>
          <p className={styles.intro}>
            A concern starts with one packaged food whose gluten-free claim does
            not match its ingredient list. Photograph the pack, say what you saw,
            and FoodProof keeps it as a private record you can build a complaint
            from later.
          </p>
          <ol className={styles.timeline}>
            <li className={styles.timelineItem}>
              <p className={styles.timelineText}>
                <strong>Photograph the label.</strong> Three things have to be
                visible across your photos: what the product is, where it says
                gluten-free, and the full ingredient list.
              </p>
            </li>
            <li className={styles.timelineItem}>
              <p className={styles.timelineText}>
                <strong>Write what does not add up</strong> and confirm the label
                wording against your own photo.
              </p>
            </li>
            <li className={styles.timelineItem}>
              <p className={styles.timelineText}>
                <strong>Prepare a complaint and send it yourself</strong> by
                email or through the official portal, then record what you sent
                and anything that came back.
              </p>
            </li>
          </ol>
          <div className={styles.actions}>
            <Link className="btn-primary" href="/pilot/reports/new">
              Raise a concern
            </Link>
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <ul className={styles.reportList}>
            {items.map((item) => {
              const next = nextStepFor(
                item.report_id,
                item.preparation,
                item.community_visibility,
                item.lifecycle,
              );
              const record = `/pilot/reports/${item.report_id}`;
              return (
                <li className={styles.reportRow} key={item.report_id}>
                  <div className={styles.reportIdentity}>
                    <h2 className={styles.rowTitle}>
                      <Link href={record}>
                        {item.product_name}
                        {item.variant ? ` · ${item.variant}` : ""}
                      </Link>
                    </h2>
                    <p className={styles.reportBrand}>{item.brand}</p>
                    <p className={styles.reportWhen}>
                      Last saved {formatDateTime(item.updated_at)}
                    </p>
                  </div>
                  <StatusChips
                    layout="stack"
                    preparation={item.preparation}
                    visibility={item.community_visibility}
                    lifecycle={item.lifecycle}
                  />
                  <div className={styles.reportNext}>
                    <p className={styles.reportNextWhy}>{next.why}</p>
                    <div className={styles.reportActions}>
                      <Link className={styles.btnSecondary} href={next.href}>
                        {next.label}
                      </Link>
                      {next.href === record ? (
                        <Link className={styles.btnQuiet} href={`${record}/edit`}>
                          Edit this report
                        </Link>
                      ) : (
                        <Link className={styles.btnQuiet} href={record}>
                          View the timeline
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {/*
            A failed "show older" used to set `failure` while `status` stayed
            "ready", so the notice above never rendered and the click looked
            like it had simply done nothing. The page failure is shown at the
            top; this one belongs next to the button that caused it.
          */}
          {status === "ready" && failure ? (
            <FailureNotice
              failure={failure}
              onRetry={() => void loadMore()}
              retryLabel="Try loading older reports again"
            />
          ) : null}
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
