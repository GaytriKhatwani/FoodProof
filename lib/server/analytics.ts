import "server-only";
import {
  AnalyticsEnvelope,
  EventProperties,
  type ClientAnalyticsEventRequest,
  type EventName,
} from "@/lib/contracts";
import { getServerEnv } from "./env";
import type { SessionContext } from "./session";

/**
 * Analytics proxy (FOODPROOF_TECHNICAL_SPEC.md §9, FOODPROOF_MEASUREMENT_AND_PILOT.md).
 * The server derives the whole envelope (actor/role/consent/audience/session/
 * mode/version) and rejects client attempts to set it, validates each event
 * against the frozen allowlist, and delivers best-effort to the dedicated demo
 * Mixpanel project. Delivery never blocks or fails the caller. No content, PII,
 * search text, or raw address is ever included.
 *
 * Live Mixpanel ingestion is verified at T4 with the real project/region/token;
 * in T1 the placeholder token short-circuits delivery so nothing is sent.
 */

const APP_VERSION = "0.1.0-demo";
const AUDIENCE = "invited_pilot" as const;

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

export const analyticsSink: AnalyticsSink = {
  async emit(envelope, event) {
    try {
      const { MIXPANEL_TOKEN, MIXPANEL_API_HOST } = getServerEnv();
      // T1 placeholder: do not attempt real delivery (finalized at T4).
      if (MIXPANEL_TOKEN.startsWith("demo-placeholder")) return;

      const payload = [
        {
          event: event.event_name,
          properties: {
            token: MIXPANEL_TOKEN,
            time: Date.parse(event.occurred_at) || Date.now(),
            $insert_id: event.event_id,
            distinct_id: envelope.analytics_actor_id,
            ...envelope,
            ...event.properties,
          },
        },
      ];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      await fetch(`${MIXPANEL_API_HOST}/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    } catch {
      // Best-effort: analytics delivery never blocks or throws.
    }
  },
};

/** DemoRole -> analytics actor_role (database `user` maps to `reporter`). */
function actorRole(role: SessionContext["actor"]["role"]): "reporter" | "reviewer" {
  return role === "reviewer" ? "reviewer" : "reporter";
}

function deriveEnvelope(session: SessionContext): AnalyticsEnvelope {
  return AnalyticsEnvelope.parse({
    analytics_actor_id: session.analytics.actorId,
    session_id: session.analytics.sessionId,
    analytics_mode: "demo",
    audience: AUDIENCE,
    actor_role: actorRole(session.actor.role),
    app_version: APP_VERSION,
    schema_version: 1,
  });
}

/**
 * Ingest a client-owned event: dropped silently without consent, validated
 * against the exact event dictionary, wrapped in the server-derived envelope,
 * and delivered best-effort. The sink is injectable for tests.
 */
export async function ingestClientEvent(
  session: SessionContext,
  event: ClientAnalyticsEventRequest,
  sink: AnalyticsSink = analyticsSink,
): Promise<{ accepted: boolean }> {
  if (!session.analytics.consent || !session.analytics.actorId || !session.analytics.sessionId) {
    return { accepted: false };
  }
  const schema = EventProperties[event.event_name];
  const properties = schema.parse(event.properties) as Record<string, unknown>;
  const envelope = deriveEnvelope(session);
  await sink.emit(envelope, {
    event_name: event.event_name,
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    properties,
  });
  return { accepted: true };
}
