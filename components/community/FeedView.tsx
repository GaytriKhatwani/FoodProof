"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import type { PublicFeedItem } from "@/lib/contracts";
import { loadFailureCopy } from "@/components/shell/errors";
import { externalStatusLabel, formatDate, productTitle } from "@/components/shell/format";
import { LoadingBlock, StateBlock } from "@/components/shell/states";
import styles from "./FeedView.module.css";

/**
 * Community feed — `/pilot/feed` (docs/FOODPROOF_SCREENS.md §3).
 *
 * Shows only the approved public projection returned by `GET /api/feed`, newest
 * publication first, with server-side search over product and brand and opaque
 * cursor pagination. There is no ranking, no comment, no reaction and no total
 * across the pilot: the count shown is the number of concerns loaded here.
 *
 * The author is always the anonymous label carried by the contract, and an
 * empty result is stated as an absence of reports — never as evidence that a
 * product is safe.
 */

const SEARCH_MAX_LENGTH = 120;

type Status = "loading" | "ready" | "error";

export function FeedView() {
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<PublicFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draftQuery, setDraftQuery] = useState("");
  /** The query the currently displayed results were fetched with. */
  const [activeQuery, setActiveQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<unknown>(null);

  // `feed_viewed` is a route-entry event: emitted once, after the first
  // successful render, and never again on a rerender or a "show more".
  const viewEmitted = useRef(false);

  const load = useCallback(async (query: string, isSearch: boolean) => {
    setStatus("loading");
    setError(null);
    setMoreError(null);
    try {
      const page = await api.feed.list(query ? { q: query } : {});
      setItems(page.items);
      setNextCursor(page.next_cursor);
      setActiveQuery(query);
      setStatus("ready");

      if (isSearch) {
        // Result count only — the search text itself is never sent to analytics.
        clientAnalytics.track("feed_search_completed", { result_count: page.items.length });
      } else if (!viewEmitted.current) {
        viewEmitted.current = true;
        clientAnalytics.track("feed_viewed", { result_count: page.items.length });
      }
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load("", false);
  }, [load]);

  async function handleShowMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.feed.list(
        activeQuery ? { q: activeQuery, cursor: nextCursor } : { cursor: nextCursor },
      );
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(draftQuery.trim(), true);
  }

  function handleClear() {
    setDraftQuery("");
    void load("", false);
  }

  const source = activeQuery ? "search" : "feed";

  return (
    <>
      <div className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Community concerns</h1>
          <p className={styles.lede}>
            Reviewed reports describe what a contributor documented. Review checks
            evidence completeness, privacy and factual wording — it does not establish
            that a product is safe, and FoodProof files nothing with any authority.
          </p>
        </div>
        <Link className="btn-primary" href="/pilot/reports/new">
          Raise a concern
        </Link>
      </div>

      <form className={styles.tools} onSubmit={handleSearch} role="search">
        <div className={styles.searchField}>
          <label className={styles.searchLabel} htmlFor="feed-search">
            Search product or brand
          </label>
          <input
            id="feed-search"
            className={styles.searchInput}
            type="search"
            value={draftQuery}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => setDraftQuery(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={styles.searchActions}>
          <button type="submit" className="btn-primary">
            Search
          </button>
          {activeQuery ? (
            <button type="button" className={styles.secondaryButton} onClick={handleClear}>
              Clear search
            </button>
          ) : null}
        </div>
        <p className={styles.toolsNote}>Newest published first. Product and brand only.</p>
      </form>

      {status === "loading" ? (
        <LoadingBlock label="Loading reviewed concerns…" lines={4} />
      ) : null}

      {status === "error" ? (
        <StateBlock
          tone="error"
          title={loadFailureCopy(error).title}
          role="alert"
          actions={
            <button
              type="button"
              className="btn-primary"
              onClick={() => void load(activeQuery, false)}
            >
              Retry
            </button>
          }
        >
          <p>{loadFailureCopy(error).body}</p>
        </StateBlock>
      ) : null}

      {status === "ready" ? (
        <>
          <p className={styles.count} aria-live="polite">
            {items.length === 0
              ? "No concerns loaded."
              : `Showing ${items.length} reviewed concern${items.length === 1 ? "" : "s"}${
                  nextCursor ? ", more available" : ""
                }.`}
          </p>

          {items.length === 0 && activeQuery ? (
            <StateBlock
              title="No reports match this search"
              actions={
                <button type="button" className="btn-primary" onClick={handleClear}>
                  Clear search
                </button>
              }
            >
              <p>
                No reviewed concern in this pilot mentions that product or brand. That is
                not a safety guarantee: it only means nobody has published a reviewed
                report about it here.
              </p>
            </StateBlock>
          ) : null}

          {items.length === 0 && !activeQuery ? (
            <StateBlock
              title="No reviewed concerns yet"
              actions={
                <Link className="btn-primary" href="/pilot/reports/new">
                  Raise a concern
                </Link>
              }
            >
              <p>
                Nothing has been approved for community visibility in this pilot yet. An
                empty feed says nothing about whether any product is safe.
              </p>
            </StateBlock>
          ) : null}

          {items.length > 0 ? (
            <ul className={styles.list}>
              {items.map((item) => (
                <li key={item.publication_revision_id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <h2 className={styles.itemTitle}>
                      <Link href={`/pilot/concerns/${item.report_id}?source=${source}`}>
                        {productTitle(item.product_name, item.variant)}
                      </Link>
                    </h2>
                    <p className={styles.itemBrand}>
                      {item.brand} · <span className={styles.sampleTag}>Illustrative example</span>
                    </p>
                    <p className={styles.itemExcerpt}>{item.concern_summary}</p>
                    <p className={styles.itemMeta}>
                      Published {formatDate(item.published_at) ?? "recently"} ·{" "}
                      {item.author_label}
                      {item.observation_date
                        ? ` · observed ${formatDate(item.observation_date)}`
                        : ""}
                    </p>
                  </div>
                  <div className={styles.itemStatuses}>
                    <p className={styles.status}>
                      <span className={styles.statusChannel}>Brand:</span>{" "}
                      {externalStatusLabel(item.external_status?.brand)}
                    </p>
                    <p className={styles.status}>
                      <span className={styles.statusChannel}>Official channel:</span>{" "}
                      {externalStatusLabel(item.external_status?.government)}
                    </p>
                    <Link
                      className={styles.viewLink}
                      href={`/pilot/concerns/${item.report_id}?source=${source}`}
                    >
                      View concern
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {moreError ? (
            <StateBlock tone="error" title="Couldn't load more concerns" role="alert">
              <p>{loadFailureCopy(moreError).body}</p>
            </StateBlock>
          ) : null}

          {nextCursor ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleShowMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Show more concerns"}
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}
