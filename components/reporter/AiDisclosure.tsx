"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { cx } from "./ui";
import styles from "./reporter.module.css";

/**
 * User-facing disclosure shown before the FIRST assisted extraction or draft in
 * a session (docs/FOODPROOF_TECHNICAL_SPEC.md §8, docs/FOODPROOF_SETUP_AND_OPERATIONS.md
 * "AI provider configuration" → Data handling).
 *
 * Assisted extraction sends the SELECTED label photographs, and assisted
 * drafting sends the CONFIRMED complaint details, to Anthropic — a third-party
 * processor, outside FoodProof. That is materially different from staying inside
 * the app, so the reporter is told what leaves and that it may be retained for
 * up to 30 days under Anthropic's standard API terms, and must take a deliberate
 * action to proceed. This choice is entirely separate from the optional Mixpanel
 * analytics consent taken at entry: agreeing here never enables analytics, and
 * analytics consent never enables this.
 *
 * The acknowledgement is remembered for the browser session only (a per-viewer
 * convenience), so the reporter is not re-asked for every suggestion in one
 * sitting. It is never sent to the server and never treated as consent for
 * anything else.
 */

export const AI_DISCLOSURE_ACK_KEY = "foodproof.aiDisclosureAcknowledged";

export function hasAcknowledgedAiDisclosure(): boolean {
  try {
    return sessionStorage.getItem(AI_DISCLOSURE_ACK_KEY) === "1";
  } catch {
    // Private mode, disabled storage, SSR: fall back to asking every time, which
    // is the safe direction for a disclosure.
    return false;
  }
}

function rememberAcknowledgement(): void {
  try {
    sessionStorage.setItem(AI_DISCLOSURE_ACK_KEY, "1");
  } catch {
    // Non-fatal: the disclosure simply shows again next time.
  }
}

/**
 * Gate an assisted action behind the disclosure. `run(action)` performs `action`
 * immediately if the disclosure was already acknowledged this session; otherwise
 * it shows the disclosure and runs `action` only after the reporter confirms.
 * The consumer renders the returned `dialog` node.
 */
export function useAiDisclosure(): {
  run: (action: () => void | Promise<void>) => void;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pendingRef = useRef<null | (() => void | Promise<void>)>(null);

  const run = useCallback((action: () => void | Promise<void>) => {
    if (hasAcknowledgedAiDisclosure()) {
      void action();
      return;
    }
    pendingRef.current = action;
    setOpen(true);
  }, []);

  const confirm = useCallback(() => {
    rememberAcknowledgement();
    setOpen(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    if (action) void action();
  }, []);

  const cancel = useCallback(() => {
    pendingRef.current = null;
    setOpen(false);
  }, []);

  const dialog = open ? (
    <Modal
      title="Before you use AI assistance"
      onClose={cancel}
      describedById="ai-disclosure-body"
    >
      <div id="ai-disclosure-body" className={styles.small}>
        <p>
          To create this suggestion, the label photos you selected and/or the
          complaint details you confirmed are sent to Anthropic, a third-party AI
          provider, and processed on Anthropic&rsquo;s servers.
        </p>
        <p>
          Under Anthropic&rsquo;s standard API terms this content is{" "}
          <strong>not used to train their models</strong>, but it{" "}
          <strong>may be kept by Anthropic for up to 30 days</strong>. Only the
          images you selected and the facts you confirmed are sent — no other
          part of your report and no photo you did not select.
        </p>
        <p>
          This is a separate choice from the analytics option you saw when you
          entered: agreeing here does not turn on analytics, and agreeing to
          analytics did not turn on this.
        </p>
      </div>
      <div className={cx(styles.actions, styles.spread)}>
        <button type="button" className={styles.btnQuiet} onClick={cancel}>
          Not now
        </button>
        <button type="button" className="btn-primary" onClick={confirm}>
          Send to AI assistance
        </button>
      </div>
    </Modal>
  ) : null;

  return { run, dialog };
}
