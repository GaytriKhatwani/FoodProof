import { afterEach, describe, expect, it, vi } from "vitest";
import { clientAnalytics } from "@/lib/analytics";
import { api } from "@/lib/client/api";

/**
 * The client adapter is fire-and-forget: a delivery failure must never surface
 * to the participant or block the action that triggered it
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md §3, "Analytics failure must never fail or
 * roll back a report save"). These tests drive the real adapter with a failing
 * transport rather than asserting on a comment.
 */

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
});

/** The adapter is browser-only; give it a window so `track` reaches the API. */
function inBrowser() {
  (globalThis as { window?: unknown }).window = {};
}

describe("clientAnalytics", () => {
  it("does not throw when the API rejects", async () => {
    inBrowser();
    const send = vi
      .spyOn(api.analytics, "send")
      .mockRejectedValue(new Error("network down"));
    expect(() => clientAnalytics.track("feed_viewed", { result_count: 0 })).not.toThrow();
    // Let the rejected promise settle: an unhandled rejection would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the API throws synchronously", () => {
    inBrowser();
    vi.spyOn(api.analytics, "send").mockImplementation(() => {
      throw new Error("boom");
    });
    // `emit` catches everything; a synchronous throw must not escape either.
    expect(() => clientAnalytics.emit({
      event_name: "feed_viewed",
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      properties: { result_count: 1 },
    })).not.toThrow();
  });

  it("sends nothing at all outside a browser (SSR)", () => {
    delete (globalThis as { window?: unknown }).window;
    const send = vi.spyOn(api.analytics, "send");
    clientAnalytics.track("feed_viewed", { result_count: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("builds a UUID event id and an ISO occurred_at", () => {
    inBrowser();
    const send = vi.spyOn(api.analytics, "send").mockResolvedValue({ accepted: true });
    clientAnalytics.track("brand_email_opened", { report_id: "r" });
    const event = send.mock.calls[0]![0];
    expect(event.event_name).toBe("brand_email_opened");
    expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(event.occurred_at).toISOString()).toBe(event.occurred_at);
  });
});
