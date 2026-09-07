import type { ReactNode } from "react";
import styles from "./states.module.css";

/**
 * The small vocabulary of non-content states used across every pilot screen:
 * loading, empty, error, forbidden, not-found and stale. They are plain blocks
 * of text with a heading and an optional action, so a state is always readable
 * to a screen reader and never signalled by colour alone.
 */

export type StateTone = "neutral" | "warning" | "error";

/**
 * Where the block stands.
 *
 * `inline` (the default) is a block inside a screen that has its own content
 * and heading. `page` is the block that IS the screen — the ended session, the
 * unreachable backend, the concern that is not available — so it gets the top
 * space and the measure of a page instead of floating in the corner of an
 * otherwise empty one.
 */
export type StatePlacement = "inline" | "page";

export function StateBlock({
  tone = "neutral",
  placement = "inline",
  title,
  children,
  actions,
  headingLevel = "h2",
  role,
  focusOnMount = false,
}: {
  tone?: StateTone;
  placement?: StatePlacement;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Use `h2` inside a page that already has an `h1`; `h1` when this IS the page. */
  headingLevel?: "h1" | "h2" | "h3";
  role?: "alert" | "status";
  /**
   * Move focus here when this block replaces the control that was focused —
   * a submitted form, for example. Without it the browser drops focus to the
   * body and a keyboard user restarts from the top of the page.
   */
  focusOnMount?: boolean;
}) {
  const Heading = headingLevel;
  return (
    <div
      className={`${styles.block} ${styles[tone]} ${
        placement === "page" ? styles.placementPage : styles.placementInline
      }`}
      role={role}
    >
      {/*
        A callback ref rather than an effect, so this module stays free of
        hooks: `LoadingBlock` beside it is rendered from a server component.
      */}
      <Heading
        className={styles.title}
        ref={focusOnMount ? (el: HTMLHeadingElement | null) => el?.focus() : undefined}
        tabIndex={focusOnMount ? -1 : undefined}
      >
        {title}
      </Heading>
      {children ? <div className={styles.body}>{children}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

/**
 * The shape a loading placeholder stands in for. A skeleton is only useful
 * when it reserves the layout that is about to arrive, so the screen does not
 * jump when it does; a generic stack of bars reserves nothing.
 *
 * `lines` is the plain stack, for short blocks inside a form or a panel.
 * `feed` reserves the community feed's ruled records, `record` the concern
 * detail's explanation-beside-evidence band, and `page` the centred block that
 * stands for a whole screen.
 */
export type LoadingShape = "lines" | "feed" | "record" | "page";

/**
 * Placeholder for content that is still loading. Reserves height so the real
 * content does not shift the page when it arrives, and carries no animation at
 * all, which keeps it safe under `prefers-reduced-motion`.
 */
export function LoadingBlock({
  label,
  lines = 3,
  shape = "lines",
}: {
  label: string;
  /** Number of bars in the `lines` shape; ignored by the composed shapes. */
  lines?: number;
  shape?: LoadingShape;
}) {
  return (
    <div className={`${styles.loading} ${styles[`loading_${shape}`]}`} aria-busy="true">
      <p className={styles.loadingLabel}>{label}</p>
      <div aria-hidden="true">
        {shape === "feed" ? (
          <div className={styles.skeletonList}>
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={styles.skeletonItem}>
                <span className={styles.skeletonThumb} />
                <div className={styles.skeletonMain}>
                  <span className={styles.skeletonHeading} />
                  <span className={styles.loadingLine} />
                  <span className={styles.loadingLine} />
                </div>
                <div className={styles.skeletonAside}>
                  <span className={styles.loadingLine} />
                  <span className={styles.loadingLine} />
                </div>
              </div>
            ))}
          </div>
        ) : shape === "record" ? (
          <div className={styles.skeletonRecord}>
            <div className={styles.skeletonMain}>
              <span className={styles.skeletonHeading} />
              <span className={styles.loadingLine} />
              <span className={styles.loadingLine} />
              <span className={styles.loadingLine} />
            </div>
            <span className={styles.skeletonEvidence} />
          </div>
        ) : (
          Array.from({ length: lines }, (_, index) => (
            <span key={index} className={styles.loadingLine} />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Inline, non-blocking message tied to a control or a completed action. Pass
 * `id` when the message explains why a specific field was refused, so the
 * field can point at it with `aria-describedby` instead of relying on the one
 * announcement an alert makes.
 */
export function InlineNote({
  tone = "neutral",
  children,
  role,
  id,
}: {
  tone?: StateTone;
  children: ReactNode;
  role?: "alert" | "status";
  id?: string;
}) {
  return (
    <p id={id} className={`${styles.inline} ${styles[tone]}`} role={role}>
      {children}
    </p>
  );
}
