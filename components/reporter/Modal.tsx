"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./reporter.module.css";

/**
 * Accessible dialog used by the record-submission, response, follow-up and
 * closure flows (docs/FOODPROOF_SCREENS.md §7–§9, "Visual and accessibility
 * defaults"): focus moves in on open, Tab is trapped inside, Escape closes, and
 * focus returns to the control that opened it. Buttons are real buttons.
 */
export function Modal({
  title,
  onClose,
  children,
  describedById,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  describedById?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  const focusable = useCallback((): HTMLElement[] => {
    const root = dialogRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const first = focusable()[0] ?? dialogRef.current;
    first?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [focusable]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [focusable, onClose]);

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        ref={dialogRef}
        tabIndex={-1}
      >
        <h2 className={styles.dialogTitle} id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
