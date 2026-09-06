import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnalyticsEnvelope, EventName } from "@/lib/contracts";
import {
  emitServerEvent,
  ingestClientEvent,
  stableEventId,
  trackPayload,
  type AnalyticsSink,
} from "@/lib/server/analytics";
import type { SessionContext } from "@/lib/server/session";

/**
 * Analytics ingestion and server-owned emission: consent gating, the
 * server-derived envelope, the event allowlist, the stable `$insert_id`, and the
 * exact set of keys that may leave this process
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md §2–§4). No live Mixpanel needed — the sink
 * is injected.
 */

interface Captured {
  envelope: AnalyticsEnvelope;
  event: {
    event_name: EventName;
    event_id: string;
    occurred_at: string;
    properties: Record<string, unknown>;
  };
}

function captureSink() {
  const calls: Captured[] = [];
  const sink: AnalyticsSink = {
    async emit(envelope, event) {
      calls.push({ envelope, event });
    },
  };
  return { sink, calls };
}

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    actor: { accessId: "a1", role: "user", label: "user@foodproof" },
    analytics: { consent: true, actorId: "act-1", sessionId: "sess-1" },
    ...overrides,
  };
}

const KEY = "3f4a1f8e-0a4b-4a2f-9d3e-1b2c3d4e5f60";

describe("analytics ingestion", () => {
  it("drops events when consent is not granted", async () => {
    const { sink, calls } = captureSink();
    const result = await ingestClientEvent(
      session({ analytics: { consent: false, actorId: null, sessionId: null } }),
      { event_name: "feed_viewed", event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), properties: { result_count: 3 } },
      sink,
    );
    expect(result.accepted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("derives the envelope server-side and maps user -> reporter", async () => {
    const { sink, calls } = captureSink();
    const result = await ingestClientEvent(
      session({}),
      { event_name: "feed_viewed", event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), properties: { result_count: 5 } },
      sink,
    );
    expect(result.accepted).toBe(true);
    expect(calls).toHaveLength(1);
    const env = calls[0]!.envelope;
    expect(env.actor_role).toBe("reporter");
    expect(env.analytics_mode).toBe("demo");
    expect(env.schema_version).toBe(1);
    expect(env.analytics_actor_id).toBe("act-1");
  });

  it("maps a reviewer session to actor_role reviewer", async () => {
    const { sink, calls } = captureSink();
    await ingestClientEvent(
      session({ actor: { accessId: "r1", role: "reviewer", label: "reviewer@foodproof" } }),
      { event_name: "feed_viewed", event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), properties: { result_count: 0 } },
      sink,
    );
    expect(calls[0]!.envelope.actor_role).toBe("reviewer");
  });

  it("rejects an event whose properties violate the dictionary", async () => {
    const { sink } = captureSink();
    await expect(
      ingestClientEvent(
        session({}),
        { event_name: "feed_viewed", event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), properties: { result_count: "lots" } },
        sink,
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("rejects an unlisted property rather than silently stripping it", async () => {
    const { sink } = captureSink();
    await expect(
      ingestClientEvent(
        session({}),
        {
          event_name: "feed_viewed",
          event_id: crypto.randomUUID(),
          occurred_at: new Date().toISOString(),
          properties: { result_count: 2, search_text: "chocolate" },
        },
        sink,
      ),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe("stableEventId", () => {
  it("is deterministic for the same (idempotency key, event name)", () => {
    expect(stableEventId(KEY, "report_saved")).toBe(stableEventId(KEY, "report_saved"));
  });

  it("differs across event names for the same key", () => {
    expect(stableEventId(KEY, "moderation_decided")).not.toBe(
      stableEventId(KEY, "report_published"),
    );
  });

  it("differs across keys for the same event name", () => {
    expect(stableEventId(KEY, "report_saved")).not.toBe(
      stableEventId("9c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f", "report_saved"),
    );
  });

  it("is accepted by the same UUID validation as a random event id", () => {
    expect(() => z.string().uuid().parse(stableEventId(KEY, "report_saved"))).not.toThrow();
  });
});

describe("emitServerEvent", () => {
  const meta = { eventId: stableEventId(KEY, "report_closed"), occurredAt: "2026-09-06T10:00:00.000Z" };

  it("drops silently without consent", async () => {
    const { sink, calls } = captureSink();
    await emitServerEvent(
      session({ analytics: { consent: false, actorId: "act-1", sessionId: "sess-1" } }),
      "report_closed",
      { report_id: crypto.randomUUID() },
      meta,
      sink,
    );
    expect(calls).toHaveLength(0);
  });

  it("drops silently once the analytics ids are cleared (consent withdrawn)", async () => {
    const { sink, calls } = captureSink();
    await emitServerEvent(
      session({ analytics: { consent: true, actorId: null, sessionId: null } }),
      "report_closed",
      { report_id: crypto.randomUUID() },
      meta,
      sink,
    );
    expect(calls).toHaveLength(0);
  });

  it("drops a property outside the allowlist WITHOUT throwing into the route", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sink, calls } = captureSink();
    await expect(
      emitServerEvent(
        session(),
        "report_closed",
        { report_id: crypto.randomUUID(), close_reason: "it was fixed" },
        meta,
        sink,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    // The warning names the event only — never the offending values.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain("it was fixed");
    warn.mockRestore();
  });

  it("never rethrows a sink failure", async () => {
    const failing: AnalyticsSink = {
      async emit() {
        throw new Error("network down");
      },
    };
    await expect(
      emitServerEvent(session(), "report_closed", { report_id: crypto.randomUUID() }, meta, failing),
    ).resolves.toBeUndefined();
  });

  it("delivers a valid event with the server-derived envelope", async () => {
    const { sink, calls } = captureSink();
    const reportId = crypto.randomUUID();
    await emitServerEvent(session(), "report_closed", { report_id: reportId }, meta, sink);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.event.event_id).toBe(meta.eventId);
    expect(calls[0]!.event.occurred_at).toBe(meta.occurredAt);
    expect(calls[0]!.event.properties).toEqual({ report_id: reportId });
  });
});

describe("the Mixpanel payload key set", () => {
  const envelope: AnalyticsEnvelope = {
    analytics_actor_id: "act-1",
    session_id: "sess-1",
    analytics_mode: "demo",
    audience: "qa",
    actor_role: "reporter",
    app_version: "0.1.0-demo",
    schema_version: 1,
  };

  it("contains EXACTLY the allowed keys and nothing else", () => {
    const payload = trackPayload("token-not-a-secret-in-this-test", envelope, {
      event_name: "submission_recorded",
      event_id: stableEventId(KEY, "submission_recorded"),
      occurred_at: "2026-09-06T10:00:00.000Z",
      properties: {
        report_id: "r",
        submission_id: "s",
        channel: "brand",
        has_acknowledgement: false,
        provenance: "user_recorded",
      },
    });

    // Whitelist: any accidental extra key fails this assertion.
    const allowed = new Set([
      "token",
      "distinct_id",
      "time",
      "$insert_id",
      // envelope (7)
      "analytics_actor_id",
      "session_id",
      "analytics_mode",
      "audience",
      "actor_role",
      "app_version",
      "schema_version",
      // this event's dictionary properties
      "report_id",
      "submission_id",
      "channel",
      "has_acknowledgement",
      "provenance",
    ]);
    const actual = Object.keys(payload.properties);
    expect(actual.filter((k) => !allowed.has(k))).toEqual([]);
    expect(new Set(actual)).toEqual(allowed);
    expect(Object.keys(payload).sort()).toEqual(["event", "properties"]);
  });

  it("sends `time` in milliseconds since the epoch, from occurred_at", () => {
    const occurred = "2026-09-06T10:00:00.123Z";
    const payload = trackPayload("t", envelope, {
      event_name: "report_closed",
      event_id: stableEventId(KEY, "report_closed"),
      occurred_at: occurred,
      properties: { report_id: "r" },
    });
    expect(payload.properties.time).toBe(Date.parse(occurred));
    // 13 digits = milliseconds; a seconds value would be 10.
    expect(String(payload.properties.time)).toHaveLength(13);
  });

  it("uses the analytics actor id as distinct_id and the event id as $insert_id", () => {
    const eventId = stableEventId(KEY, "report_reopened");
    const payload = trackPayload("t", envelope, {
      event_name: "report_reopened",
      event_id: eventId,
      occurred_at: "2026-09-06T10:00:00.000Z",
      properties: { report_id: "r" },
    });
    expect(payload.properties.distinct_id).toBe(envelope.analytics_actor_id);
    expect(payload.properties.$insert_id).toBe(eventId);
  });
});

describe("audience separation", () => {
  const original = process.env.ANALYTICS_AUDIENCE;
  beforeEach(() => {
    delete process.env.ANALYTICS_AUDIENCE;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANALYTICS_AUDIENCE;
    else process.env.ANALYTICS_AUDIENCE = original;
  });

  it("defaults to invited_pilot when unset", async () => {
    const { sink, calls } = captureSink();
    await emitServerEvent(
      session(),
      "report_closed",
      { report_id: crypto.randomUUID() },
      { eventId: stableEventId(KEY, "report_closed"), occurredAt: "2026-09-06T10:00:00.000Z" },
      sink,
    );
    expect(calls[0]!.envelope.audience).toBe("invited_pilot");
  });

  it("carries qa when the deployment/test session sets it", async () => {
    process.env.ANALYTICS_AUDIENCE = "qa";
    const { sink, calls } = captureSink();
    await emitServerEvent(
      session(),
      "report_closed",
      { report_id: crypto.randomUUID() },
      { eventId: stableEventId(KEY, "report_closed"), occurredAt: "2026-09-06T10:00:00.000Z" },
      sink,
    );
    expect(calls[0]!.envelope.audience).toBe("qa");
  });
});
