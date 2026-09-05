import type { EventName } from "@/lib/contracts";

/**
 * Client analytics adapter (FOODPROOF_MEASUREMENT_AND_PILOT.md).
 * The UI emits view/copy/handoff events through this single owner; the server
 * owns mutation-success events and the full envelope. Delivery is best-effort
 * and MUST NOT block or fail the user action. T2/T3 wire the real POST to
 * /api/analytics; T0 provides the safe no-op contract.
 */

export interface ClientAnalyticsEvent {
  event_name: EventName;
  event_id: string;
  occurred_at: string;
  properties: Record<string, unknown>;
}

export interface ClientAnalytics {
  emit(event: ClientAnalyticsEvent): void;
}

/** No-op default: never throws, never blocks. Replaced by the real adapter in T2/T3. */
export const noopClientAnalytics: ClientAnalytics = {
  emit: () => {
    /* best-effort; intentionally does nothing in T0 */
  },
};
