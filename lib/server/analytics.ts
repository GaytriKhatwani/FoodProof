import "server-only";
import type { AnalyticsEnvelope, EventName } from "@/lib/contracts";
import { notImplementedInT0 } from "./errors";

/**
 * Server analytics sink (FOODPROOF_TECHNICAL_SPEC.md §9,
 * FOODPROOF_MEASUREMENT_AND_PILOT.md). The server derives the envelope, checks
 * consent, and delivers allowlisted events best-effort to the dedicated demo
 * Mixpanel project. Delivery never blocks or rolls back a mutation. No durable
 * job system in this MVP. T1/T4 implement; T0 freezes the shape.
 */

export interface AnalyticsSink {
  emit(
    envelope: AnalyticsEnvelope,
    event: {
      event_name: EventName;
      event_id: string;
      occurred_at: string;
      properties: Record<string, unknown>;
    },
  ): Promise<void>;
}

export const t0AnalyticsSink: AnalyticsSink = {
  emit: () => notImplementedInT0("AnalyticsSink.emit"),
};
