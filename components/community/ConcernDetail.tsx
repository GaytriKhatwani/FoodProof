"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, publicationAssetUrl } from "@/lib/client/api";
import { clientAnalytics } from "@/lib/analytics";
import type { PublicReport } from "@/lib/contracts";
import { failureKind, loadFailureCopy } from "@/components/shell/errors";
import {
  CHANNEL_LABEL,
  EXTERNAL_STATUS_LABEL,
  formatDate,
  productTitle,
} from "@/components/shell/format";
import { LoadingBlock, StateBlock } from "@/components/shell/states";
import { EvidenceViewer } from "./EvidenceViewer";
import { FlagForm } from "./FlagForm";
import styles from "./ConcernDetail.module.css";

/**
 * Community concern detail — `/pilot/concerns/:reportId`
 * (docs/FOODPROOF_SCREENS.md §4).
 *
 * Everything shown here comes from the approved public projection
 * (`GET /api/feed/:id`): the frozen snapshot that a reviewer approved, plus the
 * separately reviewed response summaries. No private report field, uploader
 * identity, storage path or correspondence detail can reach this screen, and
 * the per-channel external status is the reporter's own record as it stood when
 * this version was approved — not a government or brand status.
 *
 * The API answers 404 for a concern that was never published, was withdrawn by
 * its reporter, or was removed in review. It does not distinguish them, and
 * neither does this screen: naming which one applies would leak a private
 * moderation outcome.
 */

type ViewSource = "feed" | "search" | "direct";

function readSource(raw: string | null): ViewSource {
  return raw === "feed" || raw === "search" ? raw : "direct";
}

export function ConcernDetail({ reportId }: { reportId: string }) {
  const searchParams = useSearchParams();
  const source = readSource(searchParams.get("source"));

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [report, setReport] = useState<PublicReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openAsset, setOpenAsset] = useState<string | null>(null);

  // Route-entry event, deduplicated by report + revision.
  const viewedRevision = useRef<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const result = await api.feed.get(reportId);
      setReport(result);
      setStatus("ready");
      if (viewedRevision.current !== result.publication_revision_id) {
        viewedRevision.current = result.publication_revision_id;
        clientAnalytics.track("feed_report_viewed", {
          report_id: result.report_id,
          publication_revision_id: result.publication_revision_id,
          source,
        });
      }
    } catch (err) {
      setError(err);
      setStatus("error");
    }
  }, [reportId, source]);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === "loading") {
    return (
      <>
        <p className={styles.back}>
          <Link href="/pilot/feed">Back to the feed</Link>
        </p>
        <LoadingBlock label="Loading this concern…" lines={5} />
      </>
    );
  }

  if (status === "error" || !report) {
    const notFound = failureKind(error) === "not_found";
    const copy = loadFailureCopy(error);
    return (
      <>
        <p className={styles.back}>
          <Link href="/pilot/feed">Back to the feed</Link>
        </p>
        <StateBlock
          tone={notFound ? "neutral" : "error"}
          headingLevel="h1"
          title={notFound ? "This concern is not available" : copy.title}
          role="alert"
          actions={
            notFound ? (
              <Link className="btn-primary" href="/pilot/feed">
                Back to the feed
              </Link>
            ) : (
              <button type="button" className="btn-primary" onClick={() => void load()}>
                Retry
              </button>
            )
          }
        >
          <p>
            {notFound
              ? "It may never have been published, or the reporter may have withdrawn it, or it may have been removed in review. Private records are kept either way, and nothing of them is shown here."
              : copy.body}
          </p>
        </StateBlock>
      </>
    );
  }

  const assetCount = report.approved_asset_ids.length;
  const openIndex = openAsset ? report.approved_asset_ids.indexOf(openAsset) : -1;

  return (
    <>
      <p className={styles.back}>
        <Link href="/pilot/feed">Back to the feed</Link>
      </p>

      <header className={styles.head}>
        <p className={styles.sampleTag}>Illustrative example · sample or redacted data</p>
        <h1 className={styles.title}>{productTitle(report.product_name, report.variant)}</h1>
        <p className={styles.brand}>{report.brand}</p>
        <p className={styles.meta}>
          {report.author_label} · published {formatDate(report.published_at) ?? "recently"}
          {report.observation_date ? ` · observed ${formatDate(report.observation_date)}` : ""}
        </p>
      </header>

      <div className="notice">
        <p className={styles.noticeBody}>
          Approved for publication is not verified safety. Review checks evidence
          completeness, privacy and factual wording. FoodProof does not test products, does
          not certify them, and does not file anything with any authority.
        </p>
      </div>

      <section className={styles.section} aria-labelledby="concern-heading">
        <h2 id="concern-heading" className={styles.sectionTitle}>
          Reported concern
        </h2>
        <p className={styles.body}>{report.concern_summary}</p>
      </section>

      <section className={styles.section} aria-labelledby="evidence-heading">
        <h2 id="evidence-heading" className={styles.sectionTitle}>
          Evidence
        </h2>
        {assetCount === 0 ? (
          <p className="muted">No approved images are attached to this version.</p>
        ) : (
          <ul className={styles.assetList}>
            {report.approved_asset_ids.map((assetId, index) => (
              <li key={assetId} className={styles.asset}>
                <button
                  type="button"
                  className={styles.assetButton}
                  onClick={() => setOpenAsset(assetId)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- guarded API route, unknown intrinsic size */}
                  <img
                    className={styles.assetImage}
                    src={publicationAssetUrl(assetId)}
                    alt={`Approved evidence image ${index + 1} of ${assetCount} for this concern`}
                  />
                  <span className={styles.assetCaption}>
                    Approved evidence {index + 1} of {assetCount} · open larger
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <dl className={styles.facts}>
          <dt>Label claim, as confirmed by the reporter</dt>
          <dd>
            {report.confirmed_claim_text ?? (
              <span className="muted">Not supplied in this version.</span>
            )}
          </dd>
          <dt>Ingredients, as confirmed by the reporter</dt>
          <dd>
            {report.confirmed_ingredients_text ?? (
              <span className="muted">Not supplied in this version.</span>
            )}
          </dd>
        </dl>
        <p className={styles.footnote}>
          Quoted text is what the reporter confirmed from the label they photographed. It is
          not a transcription checked by anyone else.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="actions-heading">
        <h2 id="actions-heading" className={styles.sectionTitle}>
          Recorded actions and reviewed updates
        </h2>
        <ul className={styles.statusList}>
          <li>
            <span className={styles.statusChannel}>{CHANNEL_LABEL.brand}:</span>{" "}
            {EXTERNAL_STATUS_LABEL[report.external_status.brand]}
          </li>
          <li>
            <span className={styles.statusChannel}>{CHANNEL_LABEL.government}:</span>{" "}
            {EXTERNAL_STATUS_LABEL[report.external_status.government]}
          </li>
        </ul>
        <p className={styles.footnote}>
          This is the reporter&rsquo;s own record of what they sent, frozen when this version
          was approved
          {report.external_status.as_recorded_at
            ? ` (recorded ${formatDate(report.external_status.as_recorded_at)})`
            : ""}
          . It is not a government status, it does not confirm that anything was received,
          and &ldquo;no submission recorded&rdquo; does not mean anyone ignored the reporter.
        </p>

        {report.responses.length === 0 ? (
          <p className="muted">No reviewed response has been published for this concern.</p>
        ) : (
          <ul className={styles.responseList}>
            {report.responses.map((response) => (
              <li key={response.publication_revision_id} className={styles.response}>
                <p className={styles.responseHead}>
                  {CHANNEL_LABEL[response.channel]} · {formatDate(response.occurred_at) ?? "date not recorded"}
                </p>
                <p className={styles.body}>{response.summary}</p>
                <p className={styles.footnote}>
                  Recorded by reporter
                  {response.has_attachment ? " · supporting attachment provided" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section} aria-labelledby="contribute-heading">
        <h2 id="contribute-heading" className={styles.sectionTitle}>
          Add your own experience
        </h2>
        <p>
          If you have your own evidence about this product, start a separate report. It is
          prefilled with the product identity only — never another person&rsquo;s evidence,
          complaint text or action history — and it is reviewed on its own.
        </p>
        <Link className="btn-primary" href={`/pilot/reports/new?from_concern=${report.report_id}`}>
          Report this product independently
        </Link>
      </section>

      <section className={styles.section} aria-labelledby="flag-heading">
        <h2 id="flag-heading" className={styles.sectionTitle}>
          Something wrong here?
        </h2>
        <FlagForm reportId={report.report_id} />
      </section>

      {openIndex >= 0 && openAsset ? (
        <EvidenceViewer
          open
          src={publicationAssetUrl(openAsset)}
          alt={`Approved evidence image ${openIndex + 1} of ${assetCount} for this concern`}
          caption={`Approved evidence ${openIndex + 1} of ${assetCount} · ${productTitle(
            report.product_name,
            report.variant,
          )} · illustrative example`}
          onClose={() => setOpenAsset(null)}
        />
      ) : null}
    </>
  );
}
