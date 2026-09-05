import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AnalyticsEnvelope, EventName } from "@/lib/contracts";
import { ingestClientEvent, type AnalyticsSink } from "@/lib/server/analytics";
import type { SessionContext } from "@/lib/server/session";

/**
 * Analytics ingestion: consent gating, server-derived envelope, and the event
 * allowlist (FOODPROOF_MEASUREMENT_AND_PILOT.md). No live Mixpanel needed — the
 * sink is injected.
 */

function captureSink() {
  const calls: { envelope: AnalyticsEnvelope; event: { event_name: EventName } }[] = [];
  const sink: AnalyticsSink = {
    async emit(envelope, event) {
      calls.push({ envelope, event });
    },
  };
  return { sink, calls };
}

function session(overrides: Partial<SessionContext>): SessionContext {
  return {
    actor: { accessId: "a1", role: "user", label: "user@foodproof" },
    analytics: { consent: true, actorId: "act-1", sessionId: "sess-1" },
    ...overrides,
  };
}

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
});
