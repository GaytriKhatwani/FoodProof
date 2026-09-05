import type { PublicExternalStatus } from "@/lib/contracts";

/**
 * Presentation helpers shared by the community and review screens.
 *
 * Everything here is pure formatting of values the API already returned. No
 * status is ever recomputed or inferred here: the per-channel external status
 * is the reviewed snapshot value, and its wording never asserts that anyone
 * acted, replied, or ignored a reporter.
 */

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dayMonthYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dayMonthYearUtc = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * Format an API date. Date-only values (`observation_date`) are formatted in
 * UTC so a negative local offset cannot shift them to the previous day;
 * timestamps are formatted in the reader's own zone.
 */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return ISO_DATE_ONLY.test(value)
    ? dayMonthYearUtc.format(parsed)
    : dayMonthYear.format(parsed);
}

/** Same as `formatDate`, with an explicit fallback instead of `null`. */
export function formatDateOr(value: string | null | undefined, fallback = "Not recorded"): string {
  return formatDate(value) ?? fallback;
}

/**
 * Wording for the reviewed, per-channel external status. Every label names the
 * reporter as the source; none of them describes a government or brand state.
 */
export const EXTERNAL_STATUS_LABEL: Record<PublicExternalStatus, string> = {
  no_submission_recorded: "No external submission recorded",
  submission_reported: "Submission recorded by the reporter",
  acknowledgement_attached: "Acknowledgement attached by the reporter",
  response_reported: "Response recorded by the reporter",
};

/**
 * Label one channel's reviewed status, tolerating a snapshot that does not
 * carry it. A frozen payload written before this field existed (or written by
 * anything other than the current publication service) leaves it missing, and a
 * single such record must not take the whole feed down. The fallback says the
 * status is absent from that version — it never guesses "no submission", which
 * would state something about the reporter that the snapshot does not.
 */
export function externalStatusLabel(status: PublicExternalStatus | null | undefined): string {
  if (status && status in EXTERNAL_STATUS_LABEL) {
    return EXTERNAL_STATUS_LABEL[status];
  }
  return "Not recorded in this version";
}

export const CHANNEL_LABEL: Record<"brand" | "government", string> = {
  brand: "Brand",
  government: "Official channel",
};

/** "Product · variant" when a variant exists, otherwise just the product. */
export function productTitle(productName: string, variant: string | null): string {
  return variant ? `${productName} · ${variant}` : productName;
}

/** Short, non-identifying reference for a record whose identity is not public. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}
