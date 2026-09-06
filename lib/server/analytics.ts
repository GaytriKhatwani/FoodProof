import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  AnalyticsEnvelope,
  CLIENT_OWNED_EVENTS,
  EventProperties,
  type ClientAnalyticsEventRequest,
  type EventName,
} from "@/lib/contracts";
import { analyticsAudience, getServerEnv } from "./env";
import { ApiError } from "./errors";
import type { SessionContext } from "./session";

/**
 * Analytics proxy and server-owned emission (FOODPROOF_TECHNICAL_SPEC.md §9,
 * FOODPROOF_MEASUREMENT_AND_PILOT.md §2–§4). The server derives the whole
 * envelope (actor/role/consent/audience/session/mode/version) and rejects client
 * attempts to set it, validates each event against the frozen allowlist, and
 * delivers best-effort to the dedicated demo Mixpanel project. Delivery never
 * blocks or fails the caller. No content, PII, search text, or raw address is
 * ever included — only the ids/enums/booleans/counts of the dictionary.
 */

const APP_VERSION = "0.1.0-demo";

/** Hard ceiling on one delivery attempt; analytics must never delay a mutation. */
const DELIVERY_TIMEOUT_MS = 2000;

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

/**
 * Build the exact Mixpanel `/track` payload for one event. Exported so tests can
 * assert the key set directly: it must be `token`, `distinct_id`, `time`,
 * `$insert_id`, the seven envelope fields and the allowlisted event properties —
 * and nothing else. `time` is emitted in MILLISECONDS since the UTC epoch.
 *
 * `time` unit, verified against the real endpoint on 6 September 2026 (the docs
 * say "seconds or milliseconds"): the same instant was posted to
 * `POST {MIXPANEL_API_HOST}/track?verbose=1` encoded both ways. A 10-day-old
 * instant was rejected as `{"error":"time, 10.0 days in the past (max 5.0)",
 * "status":0}` for BOTH the 10-digit (seconds) and the 13-digit (milliseconds)
 * encoding, and both "now" encodings returned `{"status":1}` — so the endpoint
 * detects the unit from the magnitude and honours milliseconds exactly. We send
 * milliseconds because `occurred_at` is a persisted database timestamp: keeping
 * sub-second precision keeps the deduplication tuple (event, time, distinct_id,
 * $insert_id) identical when an idempotent retry replays the same result.
 */
export function trackPayload(
  token: string,
  envelope: AnalyticsEnvelope,
  event: {
    event_name: EventName;
    event_id: string;
    occurred_at: string;
    properties: Record<string, unknown>;
  },
) {
  const parsed = Date.parse(event.occurred_at);
  // Spread order matters: the server-derived envelope and the fixed delivery
  // keys are written LAST, so no dictionary property added later could ever
  // shadow them.
  return {
    event: event.event_name,
    properties: {
      ...event.properties,
      ...envelope,
      token,
      distinct_id: envelope.analytics_actor_id,
      time: Number.isFinite(parsed) ? parsed : Date.now(),
      $insert_id: event.event_id,
    },
  };
}

export const analyticsSink: AnalyticsSink = {
  async emit(envelope, event) {
    try {
      const { MIXPANEL_TOKEN, MIXPANEL_API_HOST } = getServerEnv();
      // A placeholder token belongs to no project: never attempt delivery with
      // it, so a misconfigured environment cannot look like working ingestion.
      if (MIXPANEL_TOKEN.startsWith("demo-placeholder")) return;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      try {
        const res = await fetch(`${MIXPANEL_API_HOST}/track?verbose=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([trackPayload(MIXPANEL_TOKEN, envelope, event)]),
          signal: controller.signal,
        });
        // `?verbose=1` always answers 200 with { status: 1 | 0, error }.
        const body = (await res.json().catch(() => null)) as
          | { status?: number; error?: string | null }
          | null;
        if (!body || body.status !== 1) {
          // Diagnostics only: the event NAME, the HTTP status and Mixpanel's own
          // message. Never the properties, the envelope, the ids or the token.
          console.warn("[foodproof analytics] event not accepted", {
            event_name: event.event_name,
            http_status: res.status,
            verbose_status: body?.status ?? null,
            provider_error: body?.error ?? null,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
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
    audience: analyticsAudience(),
    actor_role: actorRole(session.actor.role),
    app_version: APP_VERSION,
    schema_version: 1,
  });
}

/**
 * Validate one event's properties against the frozen dictionary. `.strict()`
 * means an unlisted key is REJECTED rather than quietly dropped — the contract
 * says event-specific properties not in the dictionary are forbidden, and a
 * silent strip would hide a caller that thinks it is sending something.
 */
function validateProperties(
  eventName: EventName,
  properties: unknown,
): Record<string, unknown> {
  return EventProperties[eventName].strict().parse(properties) as Record<string, unknown>;
}

/** True when this session may contribute analytics at all. */
function consented(session: SessionContext): boolean {
  return Boolean(
    session.analytics.consent &&
      session.analytics.actorId &&
      session.analytics.sessionId,
  );
}

/**
 * Ingest a client-owned event: refused when the event is one the server owns
 * (a browser can never claim a save, publication or decision), dropped silently
 * without consent, validated against the exact event dictionary, wrapped in the
 * server-derived envelope, and delivered best-effort. The sink is injectable for
 * tests. A dictionary violation throws here (the route answers 422) — the client
 * owns its payload.
 */
export async function ingestClientEvent(
  session: SessionContext,
  event: ClientAnalyticsEventRequest,
  sink: AnalyticsSink = analyticsSink,
): Promise<{ accepted: boolean }> {
  if (!CLIENT_OWNED_EVENTS.has(event.event_name)) {
    throw new ApiError("VALIDATION_FAILED", "That event is recorded by the server, not the browser.");
  }
  if (!consented(session)) return { accepted: false };
  const properties = validateProperties(event.event_name, event.properties);
  await sink.emit(deriveEnvelope(session), {
    event_name: event.event_name,
    event_id: event.event_id,
    occurred_at: event.occurred_at,
    properties,
  });
  return { accepted: true };
}

/**
 * Emit a SERVER-owned event after a mutation has committed
 * (FOODPROOF_TECHNICAL_SPEC.md §9: "Authoritative mutation events should
 * originate from the server after commit, not both client and server").
 *
 * It never throws and never rejects: no consent, missing analytics ids, a
 * property outside the allowlist or a delivery failure all end as a silent drop
 * (a dictionary violation logs the event NAME only — never the values, which is
 * exactly the content we are not allowed to send anywhere). Callers therefore
 * cannot let analytics fail, roll back or corrupt a mutation.
 */
export async function emitServerEvent(
  session: SessionContext,
  eventName: EventName,
  properties: Record<string, unknown>,
  meta: { eventId: string; occurredAt: string },
  sink: AnalyticsSink = analyticsSink,
): Promise<void> {
  try {
    if (!consented(session)) return;
    let validated: Record<string, unknown>;
    try {
      validated = validateProperties(eventName, properties);
    } catch {
      // Content-free: a violating payload must not be echoed into a log.
      console.warn("[foodproof analytics] dropped an event failing the dictionary", {
        event_name: eventName,
      });
      return;
    }
    await sink.emit(deriveEnvelope(session), {
      event_name: eventName,
      event_id: meta.eventId,
      occurred_at: meta.occurredAt,
      properties: validated,
    });
  } catch {
    // Best-effort: a server-owned event never surfaces to the caller.
  }
}

/**
 * Deterministic `$insert_id` for a mutation's event, derived from the mutation's
 * own `Idempotency-Key` and the event name.
 *
 * A retried mutation replays its idempotency receipt (lib/server/idempotency.ts)
 * WITHOUT re-running the service, so the replayed result carries the same
 * persisted timestamps; combined with this id the retry re-sends an identical
 * `(event, time, distinct_id, $insert_id)` tuple, which Mixpanel deduplicates
 * (only the latest copy is kept). One logical save therefore counts once, as
 * FOODPROOF_MEASUREMENT_AND_PILOT.md §3 requires, without any state of our own.
 *
 * The result is formatted as a v4-shaped UUID so it satisfies the same
 * `z.string().uuid()` validation as a random event id. It is a hash of an
 * internal key, never of user content, and is not reversible to the key.
 */
export function stableEventId(idempotencyKey: string, eventName: string): string {
  const h = createHash("sha256").update(`${idempotencyKey}:${eventName}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${variant}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

/**
 * One event a route wants emitted after its service committed. Builders in
 * `lib/server/analytics-events.ts` produce these; the discriminated union ties
 * each `event_name` to exactly the dictionary's property shape at compile time.
 */
export type ServerEvent = {
  [N in EventName]: {
    event_name: N;
    occurred_at: string;
    properties: z.infer<(typeof EventProperties)[N]>;
  };
}[EventName];

/**
 * Deliver the events a committed mutation owns. Each gets a stable id derived
 * from the mutation's idempotency key, so a replayed retry is deduplicated.
 * `null` entries are the builders' "this outcome has no dictionary event" and
 * are simply skipped, so a route stays one line.
 *
 * Routes AWAIT this (they never `void` it): a serverless function can be frozen
 * the moment its response is sent, so a detached promise would make delivery
 * unreliable — and unreliable ingestion is exactly what this slice must not
 * claim. The wait is bounded by the sink's 2 s abort and never throws.
 */
export async function emitServerEvents(
  session: SessionContext,
  idempotencyKey: string,
  events: readonly (ServerEvent | null)[],
  sink: AnalyticsSink = analyticsSink,
): Promise<void> {
  for (const event of events) {
    if (!event) continue;
    await emitServerEvent(
      session,
      event.event_name,
      event.properties as Record<string, unknown>,
      {
        eventId: stableEventId(idempotencyKey, event.event_name),
        occurredAt: event.occurred_at,
      },
      sink,
    );
  }
}
