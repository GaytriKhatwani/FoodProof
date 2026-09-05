"use client";

import { useState } from "react";
import { EXTERNAL_STATUS_LABEL, formatDateOr } from "@/components/shell/format";
import styles from "./SnapshotView.module.css";

/**
 * Renders the EXACT frozen snapshot a reviewer is deciding on.
 *
 * `GET /api/review/:revisionId` types `payload` as `unknown` — it is whatever
 * the publication service froze at request time. Rather than assume a shape and
 * risk hiding a field the reviewer must see, this walks the stored object and
 * renders every key it contains, humanising the labels it recognises. Nothing
 * is read from the live report, and the raw snapshot stays one disclosure away,
 * so what is shown can always be checked against what will be published.
 */

const LABELS: Record<string, string> = {
  report_id: "Report id",
  product_id: "Product id",
  product_name: "Product name",
  brand: "Brand",
  variant: "Variant",
  concern_summary: "Concern summary",
  confirmed_claim_text: "Confirmed label claim",
  confirmed_ingredients_text: "Confirmed ingredients",
  observation_date: "Observation date",
  external_status: "External status recorded by the reporter",
  channel: "Channel",
  summary: "Response summary",
  occurred_at: "Response date",
  has_attachment: "Attachment selected",
  provenance: "Provenance",
  government: "Official channel",
  as_recorded_at: "Recorded at",
};

/** Presentation order for the keys we know about; anything else follows. */
const ORDER = [
  "product_name",
  "variant",
  "brand",
  "concern_summary",
  "confirmed_claim_text",
  "confirmed_ingredients_text",
  "observation_date",
  "channel",
  "summary",
  "occurred_at",
  "has_attachment",
  "provenance",
  "external_status",
  "product_id",
  "report_id",
];

function label(key: string): string {
  return LABELS[key] ?? key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function orderedEntries(payload: Record<string, unknown>): [string, unknown][] {
  const keys = Object.keys(payload);
  const known = ORDER.filter((key) => keys.includes(key));
  const rest = keys.filter((key) => !ORDER.includes(key)).sort();
  return [...known, ...rest].map((key) => [key, payload[key]]);
}

function renderValue(key: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="muted">Not supplied in this snapshot</span>;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (isRecord(value)) {
    return (
      <ul className={styles.nested}>
        {Object.entries(value).map(([nestedKey, nestedValue]) => (
          <li key={nestedKey}>
            <span className={styles.nestedKey}>{label(nestedKey)}:</span>{" "}
            {typeof nestedValue === "string" && nestedValue in EXTERNAL_STATUS_LABEL
              ? EXTERNAL_STATUS_LABEL[nestedValue as keyof typeof EXTERNAL_STATUS_LABEL]
              : nestedKey === "as_recorded_at"
                ? formatDateOr(typeof nestedValue === "string" ? nestedValue : null, "Not recorded")
                : String(nestedValue)}
          </li>
        ))}
      </ul>
    );
  }
  if (key === "observation_date" || key === "occurred_at") {
    return formatDateOr(String(value), "Not recorded");
  }
  return String(value);
}

export function SnapshotView({ payload }: { payload: unknown }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!isRecord(payload)) {
    return (
      <pre className={styles.raw}>{JSON.stringify(payload, null, 2)}</pre>
    );
  }

  return (
    <div>
      <dl className={styles.list}>
        {orderedEntries(payload).map(([key, value]) => (
          <div key={key} className={styles.row}>
            <dt className={styles.term}>{label(key)}</dt>
            <dd className={styles.definition}>{renderValue(key, value)}</dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        className={styles.rawToggle}
        aria-expanded={showRaw}
        onClick={() => setShowRaw((current) => !current)}
      >
        {showRaw ? "Hide the exact stored snapshot" : "Show the exact stored snapshot"}
      </button>
      {showRaw ? <pre className={styles.raw}>{JSON.stringify(payload, null, 2)}</pre> : null}
    </div>
  );
}
