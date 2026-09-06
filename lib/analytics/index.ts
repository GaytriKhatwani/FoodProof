import type { EventName } from "@/lib/contracts";
import { api } from "@/lib/client/api";

/**
 * Client analytics adapter (FOODPROOF_MEASUREMENT_AND_PILOT.md).
 * The UI emits view/copy/handoff events through this single owner; the server
 * owns mutation-success events and the full envelope (actor/role/consent/
 * audience/session/mode/version — see lib/server/analytics.ts). Delivery is
 * best-effort and MUST NOT block or fail the user action: `emit` never
 * throws, never awaits its own network call from the caller's perspective,
 * and swallows every failure (network error, non-2xx, validation rejection).
 *
 * Only allowlisted keys from FOODPROOF_MEASUREMENT_AND_PILOT.md / the
 * `EventProperties` dictionary in lib/contracts/analytics.ts are permitted per
 * event; the server re-validates and drops anything else. NEVER put report
 * text, product names, evidence, search text, addresses, or other free text
 * in `properties` — only the small set of ids/enums/booleans/counts the
 * dictionary defines for that event name.
 */

export interface ClientAnalyticsEvent {
  event_name: EventName;
  event_id: string;
  occurred_at: string;
  properties: Record<string, unknown>;
}

export interface ClientAnalytics {
  emit(event: ClientAnalyticsEvent): void;
  /** Convenience: build event_id/occurred_at and emit in one call. */
  track(event_name: EventName, properties?: Record<string, unknown>): void;
}

/**
 * The consent answer this browser has, as the server last reported it:
 * `true` allowed, `false` declined or withdrawn, `null` not yet known.
 *
 * Every optional client event is gated on it. The server already refuses an
 * event from a session without consent, but "refused after it was sent" is not
 * the promise the participant was given: withdrawing consent must stop this
 * browser ATTEMPTING to report anything, not merely stop it being stored
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md, acceptance A14). An unknown answer is
 * treated exactly like a declined one — an unknown permission is never assumed
 * to have been granted.
 */
let consentAnswer: boolean | null = null;

/**
 * Record the consent answer for this browser. `SessionProvider` calls it on
 * every read of `/api/me`, so a withdrawal takes effect on the same render that
 * updates the header; the entry form calls it too, because it learns the answer
 * before any session provider exists.
 */
export function setClientAnalyticsConsent(consent: boolean | null): void {
  consentAnswer = consent;
}

function safeRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Extremely defensive fallback; crypto.randomUUID is available in all
  // supported browsers and Node 20+, so this path should not be reached.
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** No-op default: never throws, never blocks. Used by tests and non-browser contexts. */
export const noopClientAnalytics: ClientAnalytics = {
  emit: () => {
    /* best-effort; intentionally does nothing */
  },
  track: () => {
    /* best-effort; intentionally does nothing */
  },
};

/**
 * Real adapter: POSTs to /api/analytics with `keepalive: true` so the request
 * can survive a navigation, fire-and-forget. Every failure (network, non-2xx,
 * server-side validation rejection) is caught and ignored — analytics must
 * never surface an error to the user or block the action that triggered it.
 * Guarded for non-browser environments (SSR) via `typeof window`.
 */
export const clientAnalytics: ClientAnalytics = {
  emit(event) {
    if (typeof window === "undefined") return;
    // Withdrawn, declined, or not yet answered: emit nothing. No request is
    // made at all, so there is nothing for the server to refuse.
    if (consentAnswer !== true) return;
    try {
      void api.analytics.send(event, { keepalive: true }).catch(() => {
        /* best-effort; never block or fail the user action */
      });
    } catch {
      // `.catch` only covers a REJECTED promise. Anything thrown before one
      // exists (a body that cannot be serialised, say) would otherwise escape
      // into the caller's click handler, which this adapter must never do.
    }
  },
  track(event_name, properties = {}) {
    clientAnalytics.emit({
      event_name,
      event_id: safeRandomId(),
      occurred_at: new Date().toISOString(),
      properties,
    });
  },
};
