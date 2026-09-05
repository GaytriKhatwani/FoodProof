"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ReviewQueueFlag } from "@/lib/client/api";
import type { ReviewQueueItem } from "@/lib/contracts";
import { failureKind, loadFailureCopy } from "@/components/shell/errors";
import { formatDateOr, productTitle } from "@/components/shell/format";
import { LoadingBlock, StateBlock } from "@/components/shell/states";
import { FlagRow } from "./FlagRow";
import styles from "./ReviewQueue.module.css";

/**
 * Reviewer queue — `/pilot/review` (docs/FOODPROOF_SCREENS.md §10).
 *
 * Reviewer-only. The role is decided by the invitation and enforced by the API,
 * which answers 403 for any other session; this screen shows that as an
 * explicit forbidden state and the shell does not render the Review link at
 * all. There is no way to become a reviewer from the interface.
 */

const GROUPS = [
  {
    key: "report" as const,
    title: "Pending reports",
    blurb: "First-time publication requests for a concern.",
  },
  {
    key: "response" as const,
    title: "Response updates",
    blurb: "A reviewed response summary requested on an already published concern.",
  },
  {
    key: "correction" as const,
    title: "Corrections and resubmissions",
    blurb: "A later revision of a concern the reporter has changed and resubmitted.",
  },
];

export function ReviewQueue() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [flags, setFlags] = useState<ReviewQueueFlag[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const queue = await api.review.queue();
      setItems(queue.items);
      setFlags(queue.flags);
      setStatus("ready");
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <>
        <h1 className={styles.title}>Review queue</h1>
        <LoadingBlock label="Loading the review queue…" lines={4} />
      </>
    );
  }

  if (status === "error") {
    const forbidden = failureKind(error) === "forbidden";
    const copy = loadFailureCopy(error);
    return (
      <>
        <h1 className={styles.title}>Review queue</h1>
        <StateBlock
          tone={forbidden ? "warning" : "error"}
          title={copy.title}
          role="alert"
          actions={
            forbidden ? (
              <Link className="btn-primary" href="/pilot/feed">
                Go to the community feed
              </Link>
            ) : (
              <button type="button" className="btn-primary" onClick={() => void load()}>
                Retry
              </button>
            )
          }
        >
          <p>{copy.body}</p>
        </StateBlock>
      </>
    );
  }

  const pendingCount = items.length;

  return (
    <>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Review queue</h1>
          <p className={styles.lede}>
            Review checks that the evidence supports the concern, that no personal
            information is exposed, and that the wording states what was observed. Approving
            makes a snapshot visible in the pilot community; it is not a safety verdict and
            it files nothing with any authority.
          </p>
        </div>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()}>
          Refresh queue
        </button>
      </div>

      <p className={styles.count} aria-live="polite">
        {pendingCount === 0
          ? "Nothing waiting for review."
          : `${pendingCount} request${pendingCount === 1 ? "" : "s"} waiting for review.`}
        {flags.length > 0
          ? ` ${flags.length} open flag${flags.length === 1 ? "" : "s"}.`
          : " No open flags."}
      </p>

      {pendingCount === 0 && flags.length === 0 ? (
        <StateBlock title="Nothing waiting for review">
          <p>
            No publication request and no correction flag is open. New requests appear here
            as reporters submit them.
          </p>
        </StateBlock>
      ) : null}

      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.request_type === group.key);
        if (groupItems.length === 0) return null;
        return (
          <section key={group.key} className={styles.section} aria-labelledby={`group-${group.key}`}>
            <h2 id={`group-${group.key}`} className={styles.sectionTitle}>
              {group.title}
            </h2>
            <p className={styles.sectionBlurb}>{group.blurb}</p>
            <ul className={styles.list}>
              {groupItems.map((item) => (
                <li key={item.publication_revision_id} className={styles.item}>
                  <div className={styles.itemMain}>
                    <h3 className={styles.itemTitle}>{productTitle(item.product_name, null)}</h3>
                    <p className={styles.itemMeta}>
                      {item.brand} ·{" "}
                      {item.content_kind === "response" ? "Response update" : "Concern"} ·
                      requested {formatDateOr(item.requested_at)}
                    </p>
                  </div>
                  <Link
                    className={styles.reviewLink}
                    href={`/pilot/review/${item.publication_revision_id}`}
                  >
                    Review this request
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {flags.length > 0 ? (
        <section className={styles.section} aria-labelledby="group-flags">
          <h2 id="group-flags" className={styles.sectionTitle}>
            Correction requests
          </h2>
          <p className={styles.sectionBlurb}>
            Private requests raised by pilot readers about a published concern. Handling one
            records a reason either way; removal keeps the reporter&rsquo;s private record and
            history intact.
          </p>
          <ul className={styles.list}>
            {flags.map((flag) => (
              <FlagRow
                key={flag.id}
                flag={flag}
                onHandled={(flagId) =>
                  setFlags((current) => current.filter((entry) => entry.id !== flagId))
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
