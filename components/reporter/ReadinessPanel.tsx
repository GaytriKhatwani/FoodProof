"use client";

import type { ReportDetail } from "@/lib/contracts";
import { coveredRoles, ROLE_LABEL } from "./EvidenceSection";
import { PREPARATION_LABEL, cx } from "./ui";
import styles from "./reporter.module.css";

/**
 * Readiness panel (docs/FOODPROOF_SCREENS.md §5.4, §6).
 * The STATUS shown is always `report.preparation` as the server computed it
 * (lib/server/preparation.ts) — this component never decides readiness itself.
 * The checklist below it only explains which of the server's inputs are present,
 * so a reporter can see what is still missing. Ready is an internal preparation
 * threshold: it does not mean filed, delivered, or safe.
 */

export interface ReadinessItem {
  label: string;
  done: boolean;
}

export function readinessItems(report: ReportDetail): ReadinessItem[] {
  const covered = coveredRoles(report);
  return [
    {
      label: "Product name and brand",
      done: Boolean(report.product_name.trim() && report.brand.trim()),
    },
    {
      label: "Concern explanation",
      done: Boolean(report.concern_text?.trim()),
    },
    {
      label: "Label facts confirmed by you",
      done: Boolean(report.facts_confirmed_at),
    },
    ...(["identity", "claim", "ingredients"] as const).map((role) => ({
      label: `${ROLE_LABEL[role]} photo`,
      done: covered.has(role),
    })),
  ];
}

export function ReadinessPanel({
  report,
  editHref,
}: {
  report: ReportDetail;
  editHref?: string;
}) {
  const items = readinessItems(report);
  const missing = items.filter((item) => !item.done);

  return (
    <div className={styles.panel}>
      <h2 className={styles.subTitle}>Preparation</h2>
      <p>
        The demo service reports this record as{" "}
        <strong>{PREPARATION_LABEL[report.preparation]}</strong>.
      </p>
      <ul className={styles.checklist}>
        {items.map((item) => (
          <li
            key={item.label}
            className={cx(styles.checkItem, item.done ? styles.checkDone : styles.checkTodo)}
          >
            <span className={styles.checkMark}>{item.done ? "Present" : "Missing"}</span>{" "}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && editHref ? (
        <div className={styles.actions}>
          <a className={styles.btnSecondary} href={editHref}>
            Edit the report to add what is missing
          </a>
        </div>
      ) : null}
      <p className={styles.footnote}>
        “Ready” only means this pilot has enough of your own confirmed material to
        offer the record for owner review. It is not a safety finding and no
        complaint has been filed.
      </p>
    </div>
  );
}
