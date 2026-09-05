"use client";

import { useId, useState } from "react";
import { api, type ProductMatch } from "@/lib/client/api";
import { failureKind } from "@/components/shell/errors";
import { InlineNote } from "@/components/shell/states";
import { useActionKey } from "@/components/shell/useActionKey";
import styles from "./ReviewDetail.module.css";

/**
 * Reviewer moderation on the report behind a review request
 * (docs/FOODPROOF_SCREENS.md §10).
 *
 * Removal takes the published version out of the community and cancels
 * anything still awaiting approval; it never destroys source evidence, and it
 * requires a written reason. Relinking corrects which product a report is
 * attached to — it does not edit the approved public text, which would need a
 * new consented revision from the reporter. Both actions log their reason.
 */
export function ModerationActions({ reportId }: { reportId: string }) {
  const removeReasonId = useId();
  const relinkReasonId = useId();
  const brandId = useId();
  const nameId = useId();
  const variantId = useId();

  const [open, setOpen] = useState(false);
  const [removeReason, setRemoveReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
  const [removeKeyFor, resetRemoveKey] = useActionKey();

  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [matches, setMatches] = useState<ProductMatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [relinkReason, setRelinkReason] = useState("");
  const [searching, setSearching] = useState(false);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const [relinked, setRelinked] = useState(false);
  const [relinkKeyFor, resetRelinkKey] = useActionKey();

  function describe(error: unknown, fallback: string): string {
    switch (failureKind(error)) {
      case "forbidden":
        return "Reviewer access is required for this action.";
      case "not_found":
        return "That record could not be found. Reload the queue.";
      case "conflict":
        return "This changed since you loaded it. Reload before acting.";
      case "unavailable":
        return "The demo service could not be reached, so nothing was recorded. Try again.";
      default:
        return fallback;
    }
  }

  async function handleRemove() {
    setRemoveError(null);
    const reason = removeReason.trim();
    if (!reason) {
      setRemoveError("A reason is required to remove content from the community.");
      return;
    }
    setRemoveBusy(true);
    try {
      await api.review.remove(reportId, { reason }, removeKeyFor(reason));
      resetRemoveKey();
      setRemoved(true);
    } catch (error) {
      setRemoveError(describe(error, "That removal could not be recorded. Try again."));
    } finally {
      setRemoveBusy(false);
    }
  }

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRelinkError(null);
    setMatches(null);
    setSelected(null);
    if (!brand.trim() || !name.trim()) {
      setRelinkError("Enter both a brand and a product name to search.");
      return;
    }
    setSearching(true);
    try {
      const result = await api.products.matches({
        brand: brand.trim(),
        name: name.trim(),
        ...(variant.trim() ? { variant: variant.trim() } : {}),
      });
      setMatches(result.matches);
    } catch (error) {
      setRelinkError(describe(error, "That search could not be completed. Try again."));
    } finally {
      setSearching(false);
    }
  }

  async function handleRelink() {
    setRelinkError(null);
    const reason = relinkReason.trim();
    if (!selected) {
      setRelinkError("Choose the product this report should be linked to.");
      return;
    }
    if (!reason) {
      setRelinkError("A reason is required to relink a report.");
      return;
    }
    setRelinkBusy(true);
    try {
      await api.review.relink(
        reportId,
        { product_id: selected, reason },
        relinkKeyFor(`${selected}:${reason}`),
      );
      resetRelinkKey();
      setRelinked(true);
    } catch (error) {
      setRelinkError(describe(error, "That relink could not be recorded. Try again."));
    } finally {
      setRelinkBusy(false);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="moderation-heading">
      <h2 id="moderation-heading" className={styles.sectionTitle}>
        Moderate this report
      </h2>
      <p className={styles.footnote}>
        These act on the report itself rather than on this request. Both record a reason, and
        neither deletes the reporter&rsquo;s private record, evidence or history.
      </p>

      <button
        type="button"
        className={styles.linkButton}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "Hide moderation actions" : "Show moderation actions"}
      </button>

      <div hidden={!open}>
        <div className={styles.moderationBlock}>
          <h3 className={styles.moderationTitle}>Remove from the community</h3>
          {removed ? (
            <InlineNote tone="warning" role="status">
              Removed from the community, with your reason recorded. The published version is
              hidden and anything still awaiting approval for this report is cancelled. The
              private record is kept.
            </InlineNote>
          ) : (
            <>
              <label className={styles.label} htmlFor={removeReasonId}>
                Reason (required)
              </label>
              <textarea
                id={removeReasonId}
                className={styles.textarea}
                rows={3}
                value={removeReason}
                onChange={(event) => setRemoveReason(event.target.value)}
                aria-invalid={removeError ? true : undefined}
              />
              <div className={styles.decisionActions}>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void handleRemove()}
                  disabled={removeBusy}
                >
                  {removeBusy ? "Removing…" : "Remove from the community"}
                </button>
              </div>
              {removeError ? (
                <InlineNote tone="error" role="alert">
                  {removeError}
                </InlineNote>
              ) : null}
            </>
          )}
        </div>

        <div className={styles.moderationBlock}>
          <h3 className={styles.moderationTitle}>Relink to another product</h3>
          {relinked ? (
            <InlineNote tone="warning" role="status">
              Relinked, with your reason recorded. The approved public text is unchanged: a
              correction to what the concern says needs a new consented revision from the
              reporter.
            </InlineNote>
          ) : (
            <>
              <form className={styles.relinkSearch} onSubmit={handleSearch} noValidate>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={brandId}>
                    Brand
                  </label>
                  <input
                    id={brandId}
                    className={styles.input}
                    value={brand}
                    onChange={(event) => setBrand(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={nameId}>
                    Product name
                  </label>
                  <input
                    id={nameId}
                    className={styles.input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor={variantId}>
                    Variant (optional)
                  </label>
                  <input
                    id={variantId}
                    className={styles.input}
                    value={variant}
                    onChange={(event) => setVariant(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <button type="submit" className={styles.secondaryButton} disabled={searching}>
                  {searching ? "Searching…" : "Find matching products"}
                </button>
              </form>

              {matches !== null ? (
                matches.length === 0 ? (
                  <p className="muted">
                    No product record matches that brand and name, so there is nothing to
                    relink to.
                  </p>
                ) : (
                  <fieldset className={styles.checklist}>
                    <legend className={styles.legend}>Choose the correct product</legend>
                    {matches.map((match) => (
                      <label key={match.product_id} className={styles.check}>
                        <input
                          type="radio"
                          name="relink-product"
                          value={match.product_id}
                          checked={selected === match.product_id}
                          onChange={() => setSelected(match.product_id)}
                        />
                        {match.brand} · {match.name}
                        {match.variant ? ` · ${match.variant}` : ""}
                      </label>
                    ))}
                  </fieldset>
                )
              ) : null}

              <label className={styles.label} htmlFor={relinkReasonId}>
                Reason (required)
              </label>
              <textarea
                id={relinkReasonId}
                className={styles.textarea}
                rows={3}
                value={relinkReason}
                onChange={(event) => setRelinkReason(event.target.value)}
                aria-invalid={relinkError ? true : undefined}
              />
              <div className={styles.decisionActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void handleRelink()}
                  disabled={relinkBusy}
                >
                  {relinkBusy ? "Relinking…" : "Relink this report"}
                </button>
              </div>
              {relinkError ? (
                <InlineNote tone="error" role="alert">
                  {relinkError}
                </InlineNote>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
