"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./EvidenceViewer.module.css";

/**
 * Full-size viewer for one approved evidence image.
 *
 * Uses a native modal `<dialog>`, so focus is trapped and Escape closes it
 * without a custom key handler; focus is returned to the trigger explicitly on
 * close. Zoom is a plain toggle rather than a gesture, so it is fully keyboard
 * operable. The image itself is streamed by the guarded media route — this
 * never receives a storage path or a public URL.
 */
export function EvidenceViewer({
  open,
  src,
  alt,
  caption,
  onClose,
}: {
  open: boolean;
  src: string;
  alt: string;
  caption: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [zoomed, setZoomed] = useState(false);

  /**
   * Fires for every close path — the Close button, Escape (cancel then close)
   * and a programmatic close — so focus returns to the trigger exactly once.
   */
  const handleClose = useCallback(() => {
    setZoomed(false);
    onClose();
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label="Evidence image"
      onClose={handleClose}
    >
      <div className={styles.bar}>
        <p className={styles.caption}>{caption}</p>
        <div className={styles.barActions}>
          <button
            type="button"
            className={styles.barButton}
            onClick={() => setZoomed((current) => !current)}
            aria-pressed={zoomed}
          >
            {zoomed ? "Fit to screen" : "Zoom in"}
          </button>
          <button type="button" className={styles.barButton} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      <div className={styles.canvas}>
        {/* eslint-disable-next-line @next/next/no-img-element -- guarded API route, unknown intrinsic size */}
        <img
          className={zoomed ? `${styles.image} ${styles.imageZoomed}` : styles.image}
          src={src}
          alt={alt}
        />
      </div>
    </dialog>
  );
}
