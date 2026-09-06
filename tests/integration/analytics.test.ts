import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { AnalyticsEnvelope, EventName, ReportWriteRequest } from "@/lib/contracts";
import {
  analyticsSink,
  emitServerEvent,
  emitServerEvents,
  stableEventId,
  trackPayload,
  type AnalyticsSink,
} from "@/lib/server/analytics";
import { reportSavedEvent } from "@/lib/server/analytics-events";
import { sessionService, setAnalyticsConsent, type SessionContext } from "@/lib/server/session";
import { createReport } from "@/lib/server/reports";
import {
  createAccess,
  deleteAccess,
  deleteAttempts,
  liveSuite,
  randomAddressHmac,
  sha256Hex,
  testClient,
} from "../helpers/live";

/**
 * Live analytics acceptance (T4).
 *
 * Three things are proven here against the real dependencies:
 *  1. INGESTION — the exact payload `analyticsSink` builds is accepted by the
 *     configured Mixpanel region host (`?verbose=1` answers `{status: 1}`), and
 *     an identical duplicate is accepted too (deduplication is server-side).
 *  2. CONSENT — a declined session emits nothing, and withdrawing consent clears
 *     the analytics identifiers in `demo_sessions` so nothing is emitted after.
 *  3. RETRY — a mutation replayed through its idempotency receipt reproduces an
 *     identical `(event, time, distinct_id, $insert_id)` tuple, which is what
 *     makes Mixpanel's deduplication collapse it to one logical save.
 *
 * READ-BACK IS NOT VERIFIED HERE. The demo Mixpanel project has no service
 * account, so no test can query what landed. `{status: 1}` is Mixpanel accepting
 * the event for ingestion; the owner confirms the events and their properties in
 * Live View (see the final report for the exact steps). Nothing in this file
 * should be read as evidence that an event appeared in a report.
 */

const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN ?? "";
const MIXPANEL_API_HOST = process.env.MIXPANEL_API_HOST ?? "";
const mixpanelConfigured =
  Boolean(MIXPANEL_TOKEN && MIXPANEL_API_HOST) &&
  !MIXPANEL_TOKEN.startsWith("demo-placeholder");
const mixpanelReason = !MIXPANEL_TOKEN || !MIXPANEL_API_HOST
  ? "MIXPANEL_TOKEN / MIXPANEL_API_HOST not set"
  : "MIXPANEL_TOKEN is a placeholder — no real project to ingest into";

const gate = await liveSuite("analytics (live Supabase + Mixpanel)");

gate.run(gate.title, () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const usedHmacs: string[] = [];

  afterAll(async () => {
    await deleteAccess(client, createdAccess);
    await deleteAttempts(client, usedHmacs);
  });

  function freshHmac(): string {
    const h = randomAddressHmac();
    usedHmacs.push(h);
    return h;
  }

  /** A real invited session, optionally with analytics consent allowed. */
  async function pilotSession(consent: boolean): Promise<{
    token: string;
    context: SessionContext;
    accessId: string;
  }> {
    const access = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(access.accessId);
    const created = await sessionService.createSession(access.code, freshHmac());
    const token = created.cookie.value;
    if (consent) await setAnalyticsConsent(token, true);
    const context = await sessionService.resolveSession(token);
    expect(context).not.toBeNull();
    return { token, context: context!, accessId: access.accessId };
  }

  function capture() {
    const calls: {
      envelope: AnalyticsEnvelope;
      event: {
        event_name: EventName;
        event_id: string;
        occurred_at: string;
        properties: Record<string, unknown>;
      };
    }[] = [];
    const sink: AnalyticsSink = {
      async emit(envelope, event) {
        calls.push({ envelope, event });
      },
    };
    return { sink, calls };
  }

  async function postTrack(payload: unknown): Promise<{ status?: number; error?: string | null }> {
    const res = await fetch(`${MIXPANEL_API_HOST}/track?verbose=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([payload]),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { status?: number; error?: string | null };
  }

  // --- 1. Ingestion acceptance ------------------------------------------------

  const ingestion = mixpanelConfigured ? it : it.skip;

  ingestion(
    mixpanelConfigured
      ? "the sink's exact payload is accepted by the configured Mixpanel host"
      : `SKIPPED: ${mixpanelReason}`,
    async () => {
      const { context } = await pilotSession(true);
      const envelope: AnalyticsEnvelope = {
        analytics_actor_id: context.analytics.actorId!,
        session_id: context.analytics.sessionId!,
        analytics_mode: "demo",
        audience: "qa",
        actor_role: "reporter",
        app_version: "0.1.0-demo",
        schema_version: 1,
      };
      const event = {
        event_name: "feed_viewed" as const,
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        properties: { result_count: 0 },
      };
      const payload = trackPayload(MIXPANEL_TOKEN, envelope, event);

      const first = await postTrack(payload);
      expect(first.status).toBe(1);
      expect(first.error ?? null).toBeNull();

      // The SAME event again: identical (event, time, distinct_id, $insert_id).
      // Mixpanel accepts it and deduplicates server-side — the API never
      // reports a duplicate as an error, so a client retry is always safe.
      const second = await postTrack(payload);
      expect(second.status).toBe(1);
      expect(second.error ?? null).toBeNull();
    },
    30_000,
  );

  ingestion(
    mixpanelConfigured
      ? "the real sink reaches Mixpanel: an accepted event is silent, a rejected one warns"
      : `SKIPPED: ${mixpanelReason}`,
    async () => {
      const { context } = await pilotSession(true);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        // The production path end to end: real envelope, real sink, real host.
        await expect(
          emitServerEvent(
            context,
            "feed_viewed",
            { result_count: 0 },
            { eventId: randomUUID(), occurredAt: new Date().toISOString() },
            analyticsSink,
          ),
        ).resolves.toBeUndefined();
        expect(warn).not.toHaveBeenCalled();

        // Now an event Mixpanel MUST reject: it refuses anything older than 5
        // days. The warning proves the sink really posted and really read the
        // verbose body — "no warning" above is therefore evidence of acceptance,
        // not of a request that silently failed to leave the process.
        const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
        await emitServerEvent(
          context,
          "feed_viewed",
          { result_count: 0 },
          { eventId: randomUUID(), occurredAt: tenDaysAgo },
          analyticsSink,
        );
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(warn.mock.calls[0]);
        expect(logged).toContain("feed_viewed");
        expect(logged).toContain("days in the past");
        // Diagnostics carry no identifiers, no token and no properties.
        expect(logged).not.toContain(context.analytics.actorId!);
        expect(logged).not.toContain(MIXPANEL_TOKEN);
        expect(logged).not.toContain("result_count");
      } finally {
        warn.mockRestore();
      }
    },
    30_000,
  );

  // --- 2. Consent -------------------------------------------------------------

  it("a session that DECLINED analytics emits nothing", async () => {
    const { token, context } = await pilotSession(false);
    expect(context.analytics.consent).toBe(false);
    expect(context.analytics.actorId).toBeNull();

    const { sink, calls } = capture();
    await emitServerEvent(
      context,
      "report_closed",
      { report_id: randomUUID() },
      { eventId: randomUUID(), occurredAt: new Date().toISOString() },
      sink,
    );
    expect(calls).toHaveLength(0);

    // And the stored session carries no analytics identity to leak.
    const { data } = await client
      .from("demo_sessions")
      .select("analytics_consent, analytics_actor_id, analytics_session_id")
      .eq("token_hash", sha256Hex(token))
      .maybeSingle();
    expect(data?.analytics_consent).toBe(false);
    expect(data?.analytics_actor_id).toBeNull();
    expect(data?.analytics_session_id).toBeNull();
  });

  it("withdrawing consent clears the identifiers and stops emission", async () => {
    const { token, context: allowed } = await pilotSession(true);
    expect(allowed.analytics.consent).toBe(true);
    expect(allowed.analytics.actorId).not.toBeNull();

    const before = capture();
    await emitServerEvent(
      allowed,
      "report_closed",
      { report_id: randomUUID() },
      { eventId: randomUUID(), occurredAt: new Date().toISOString() },
      before.sink,
    );
    expect(before.calls).toHaveLength(1);

    await setAnalyticsConsent(token, false);

    const { data } = await client
      .from("demo_sessions")
      .select("analytics_consent, analytics_actor_id, analytics_session_id")
      .eq("token_hash", sha256Hex(token))
      .maybeSingle();
    expect(data?.analytics_consent).toBe(false);
    expect(data?.analytics_actor_id).toBeNull();
    expect(data?.analytics_session_id).toBeNull();

    const withdrawn = await sessionService.resolveSession(token);
    expect(withdrawn).not.toBeNull();
    const after = capture();
    await emitServerEvent(
      withdrawn!,
      "report_closed",
      { report_id: randomUUID() },
      { eventId: randomUUID(), occurredAt: new Date().toISOString() },
      after.sink,
    );
    expect(after.calls).toHaveLength(0);
  });

  // --- 3. Idempotent retry ----------------------------------------------------

  it("a replayed mutation re-sends an identical deduplication tuple", async () => {
    const { context } = await pilotSession(true);
    const flowId = randomUUID();
    const key = randomUUID();
    const body: ReportWriteRequest = {
      product_name: "Sample Pantry Crackers",
      brand: "Sample Pantry",
      variant: null,
      concern_text: "SAMPLE: label claims gluten-free but lists wheat.",
      claim_text: null,
      ingredients_text: null,
      expected_version: null,
    };

    // First attempt.
    const first = await createReport(context.actor.accessId, body, key);
    const firstCapture = capture();
    await emitServerEvents(
      context,
      key,
      [reportSavedEvent(first, flowId, true)],
      firstCapture.sink,
    );

    // Identical retry: the receipt REPLAYS the stored result — no second row.
    const replayed = await createReport(context.actor.accessId, body, key);
    expect(replayed).toEqual(first);
    const { count } = await client
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("owner_access_id", context.actor.accessId);
    expect(count).toBe(1);

    const secondCapture = capture();
    await emitServerEvents(
      context,
      key,
      [reportSavedEvent(replayed, flowId, true)],
      secondCapture.sink,
    );

    // The stable id is the same both times...
    expect(stableEventId(key, "report_saved")).toBe(firstCapture.calls[0]!.event.event_id);
    expect(secondCapture.calls[0]!.event.event_id).toBe(firstCapture.calls[0]!.event.event_id);

    // ...and so is the whole tuple Mixpanel deduplicates on.
    const tuple = (c: typeof firstCapture) => {
      const payload = trackPayload("token", c.calls[0]!.envelope, c.calls[0]!.event);
      return {
        event: payload.event,
        time: payload.properties.time,
        distinct_id: payload.properties.distinct_id,
        $insert_id: payload.properties.$insert_id,
      };
    };
    expect(tuple(secondCapture)).toEqual(tuple(firstCapture));
    // The persisted timestamp is what makes `time` stable, not the clock.
    expect(firstCapture.calls[0]!.event.occurred_at).toBe(first.updated_at);
  });
});
