import { describe, expect, it } from "vitest";
import { EventProperties, type ReportDetail } from "@/lib/contracts";
import {
  complaintDraftSavedEvent,
  decisionEvents,
  evidenceComplete,
  evidenceUploadedEvent,
  factsConfirmedEvent,
  flagResolutionEvent,
  lifecycleEvent,
  parseFlowId,
  publicationRequestedEvent,
  publicationWithdrawnEvent,
  removalEvent,
  reportSavedEvent,
  submissionRecordedEvent,
  updateRecordedEvent,
} from "@/lib/server/analytics-events";
import type { ServerEvent } from "@/lib/server/analytics";

/**
 * The per-route event builders (FOODPROOF_MEASUREMENT_AND_PILOT.md §4). These
 * are the whole mapping from a committed mutation to its analytics event, so
 * every "emit nothing" case is asserted here rather than being trusted.
 *
 * Every produced event is additionally re-validated against the frozen
 * dictionary, so a builder can never construct something the sink would drop.
 */

const REPORT = "11111111-1111-4111-8111-111111111111";
const REVISION = "22222222-2222-4222-8222-222222222222";
const FLOW = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const AT = "2026-09-06T10:00:00.000Z";

/** Assert the built event actually satisfies the frozen dictionary. */
function valid(event: ServerEvent | null): ServerEvent {
  expect(event).not.toBeNull();
  const e = event!;
  expect(() => EventProperties[e.event_name].strict().parse(e.properties)).not.toThrow();
  return e;
}

function detail(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    report_id: REPORT,
    product_id: null,
    product_name: "Sample",
    brand: "Fictional",
    variant: null,
    concern_text: null,
    claim_text: null,
    ingredients_text: null,
    facts_confirmed_at: null,
    observation_date: null,
    batch_number: null,
    preparation: "draft",
    lifecycle: "open",
    close_reason: null,
    community_visibility: "private",
    version: 1,
    created_at: AT,
    updated_at: AT,
    evidence: [],
    complaint_drafts: [],
    submissions: [],
    updates: [],
    review_requests: [],
    ...overrides,
  };
}

function label(roles: ("identity" | "claim" | "ingredients")[], state: "ready" | "pending" = "ready") {
  return {
    id: crypto.randomUUID(),
    kind: "label" as const,
    roles,
    mime_type: "image/jpeg",
    bytes: 100,
    upload_state: state,
    created_at: AT,
  };
}

describe("parseFlowId", () => {
  it("accepts a UUID X-Flow-Id", () => {
    expect(parseFlowId(new Headers({ "X-Flow-Id": FLOW }))).toBe(FLOW);
  });

  it("returns null for a missing or malformed header — never an invented id", () => {
    expect(parseFlowId(new Headers())).toBeNull();
    expect(parseFlowId(new Headers({ "X-Flow-Id": "not-a-uuid" }))).toBeNull();
    expect(parseFlowId(new Headers({ "X-Flow-Id": "" }))).toBeNull();
  });
});

describe("evidenceComplete", () => {
  it("is true only when ready label evidence covers identity, claim and ingredients", () => {
    expect(evidenceComplete({ evidence: [] })).toBe(false);
    expect(evidenceComplete({ evidence: [label(["identity", "claim"])] })).toBe(false);
    expect(
      evidenceComplete({ evidence: [label(["identity"]), label(["claim", "ingredients"])] }),
    ).toBe(true);
  });

  it("ignores evidence that is not a ready label", () => {
    expect(
      evidenceComplete({ evidence: [label(["identity", "claim", "ingredients"], "pending")] }),
    ).toBe(false);
    expect(
      evidenceComplete({
        evidence: [
          { ...label([]), kind: "acknowledgement" as const },
          label(["identity", "claim", "ingredients"]),
        ],
      }),
    ).toBe(true);
  });
});

describe("report_saved", () => {
  it("carries the flow id, the persisted updated_at, and first-save/evidence flags", () => {
    const d = detail({ evidence: [label(["identity", "claim", "ingredients"])] });
    const event = valid(reportSavedEvent(d, FLOW, true));
    expect(event).toEqual({
      event_name: "report_saved",
      occurred_at: AT,
      properties: {
        flow_id: FLOW,
        report_id: REPORT,
        is_first_save: true,
        evidence_complete: true,
      },
    });
  });

  it("emits NOTHING when the X-Flow-Id header was absent or invalid", () => {
    expect(reportSavedEvent(detail(), null, true)).toBeNull();
    expect(reportSavedEvent(detail(), parseFlowId(new Headers({ "X-Flow-Id": "nope" })), false))
      .toBeNull();
  });

  it("marks a later save as not-first", () => {
    expect(valid(reportSavedEvent(detail(), FLOW, false)).properties).toMatchObject({
      is_first_save: false,
      evidence_complete: false,
    });
  });
});

describe("facts_confirmed", () => {
  it("uses the persisted confirmation timestamp", () => {
    const d = detail({ facts_confirmed_at: "2026-09-06T11:22:33.444Z" });
    const event = valid(factsConfirmedEvent(d, "manual"));
    expect(event.occurred_at).toBe("2026-09-06T11:22:33.444Z");
    expect(event.properties).toEqual({ report_id: REPORT, method: "manual" });
  });

  it("emits nothing when confirmation is not actually persisted", () => {
    expect(factsConfirmedEvent(detail({ facts_confirmed_at: null }), "manual")).toBeNull();
  });
});

describe("evidence_uploaded", () => {
  it("maps label / acknowledgement / response to the matching purpose", () => {
    for (const kind of ["label", "acknowledgement", "response"] as const) {
      const event = valid(evidenceUploadedEvent(REPORT, { ...label([]), kind }));
      expect(event.properties).toMatchObject({ report_id: REPORT, purpose: kind });
      expect(event.occurred_at).toBe(AT);
    }
  });

  it("emits NOTHING for a receipt (the receipt metric is deliberately omitted)", () => {
    expect(evidenceUploadedEvent(REPORT, { ...label([]), kind: "receipt" })).toBeNull();
  });
});

describe("complaint_draft_saved", () => {
  it("reports channel and method from the persisted draft", () => {
    const event = valid(
      complaintDraftSavedEvent(REPORT, {
        id: OTHER,
        channel: "government",
        subject: "s",
        body: "b",
        method: "template",
        version: 0,
        updated_at: AT,
      }),
    );
    expect(event.properties).toEqual({
      report_id: REPORT,
      draft_id: OTHER,
      channel: "government",
      method: "template",
    });
    // Never the subject or body.
    expect(JSON.stringify(event)).not.toContain("\"s\"");
  });
});

describe("submission_recorded", () => {
  it("reports the channel, acknowledgement flag and user_recorded provenance", () => {
    const event = valid(
      submissionRecordedEvent(REPORT, {
        id: OTHER,
        channel: "brand",
        recipient: "Consumer care <care@example.invalid>",
        submitted_at: "2026-09-01",
        reference: "REF-123",
        has_acknowledgement: true,
        created_at: AT,
      }),
    );
    expect(event.properties).toEqual({
      report_id: REPORT,
      submission_id: OTHER,
      channel: "brand",
      has_acknowledgement: true,
      provenance: "user_recorded",
    });
    // The recipient and reference number never leave the server.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain("REF-123");
  });
});

describe("updates", () => {
  const base = {
    id: OTHER,
    submission_id: REVISION,
    sender: "Brand (simulated)",
    occurred_at: "2026-09-02",
    summary: "SIMULATED: they replied.",
    has_attachment: true,
    created_at: AT,
  };

  it("maps a follow-up to followup_recorded with the submission's channel", () => {
    const event = valid(updateRecordedEvent(REPORT, { ...base, kind: "follow_up" }, "government"));
    expect(event.event_name).toBe("followup_recorded");
    expect(event.properties).toEqual({
      report_id: REPORT,
      submission_id: REVISION,
      followup_id: OTHER,
      channel: "government",
    });
  });

  it("maps a response to response_added, carrying only the attachment flag", () => {
    const event = valid(updateRecordedEvent(REPORT, { ...base, kind: "response" }, "brand"));
    expect(event.event_name).toBe("response_added");
    expect(event.properties).toEqual({
      report_id: REPORT,
      submission_id: REVISION,
      response_id: OTHER,
      channel: "brand",
      has_attachment: true,
    });
    expect(JSON.stringify(event)).not.toContain("SIMULATED");
  });

  it("emits nothing for lifecycle updates or an update with no submission", () => {
    expect(updateRecordedEvent(REPORT, { ...base, kind: "closed" }, "brand")).toBeNull();
    expect(updateRecordedEvent(REPORT, { ...base, kind: "reopened" }, "brand")).toBeNull();
    expect(
      updateRecordedEvent(REPORT, { ...base, kind: "response", submission_id: null }, "brand"),
    ).toBeNull();
  });
});

describe("lifecycle", () => {
  it("maps close and reopen to their events", () => {
    expect(valid(lifecycleEvent(detail(), "closed")).event_name).toBe("report_closed");
    expect(valid(lifecycleEvent(detail(), "reopened")).event_name).toBe("report_reopened");
  });

  it("never carries the closure reason", () => {
    const event = lifecycleEvent(detail({ close_reason: "the brand fixed the pack" }), "closed");
    expect(JSON.stringify(event)).not.toContain("fixed the pack");
  });
});

describe("publication_requested", () => {
  it("uses the revision's persisted created_at and its content kind", () => {
    const event = valid(
      publicationRequestedEvent(REPORT, {
        publication_revision_id: REVISION,
        content_kind: "response",
        state: "pending_review",
        reason: null,
        revision: 1,
        created_at: AT,
      }),
    );
    expect(event.occurred_at).toBe(AT);
    expect(event.properties).toEqual({
      report_id: REPORT,
      publication_revision_id: REVISION,
      content_kind: "response",
    });
  });
});

describe("publication_withdrawn", () => {
  it("is emitted only when feed visibility was actually removed", () => {
    const event = valid(
      publicationWithdrawnEvent({
        report_id: REPORT,
        withdrawn: true,
        hidden: true,
        publication_revision_id: REVISION,
        withdrawn_at: AT,
      }),
    );
    expect(event.properties).toEqual({
      report_id: REPORT,
      publication_revision_id: REVISION,
    });
  });

  it("emits NOTHING when nothing was visible (hidden=false)", () => {
    expect(
      publicationWithdrawnEvent({
        report_id: REPORT,
        withdrawn: true,
        hidden: false,
        publication_revision_id: null,
        withdrawn_at: AT,
      }),
    ).toBeNull();
    expect(
      publicationWithdrawnEvent({
        report_id: REPORT,
        withdrawn: true,
        hidden: false,
        publication_revision_id: REVISION,
        withdrawn_at: AT,
      }),
    ).toBeNull();
  });
});

describe("moderation decisions", () => {
  const decision = (state: "approved" | "changes_requested" | "rejected", kind: "concern" | "response") => ({
    publication_revision_id: REVISION,
    report_id: REPORT,
    content_kind: kind,
    state,
    reason: "Please crop the ingredients photo.",
    revision: 1,
    created_at: AT,
    reviewed_at: "2026-09-06T12:00:00.000Z",
  });

  it("approving a CONCERN emits moderation_decided AND report_published", () => {
    const events = decisionEvents(decision("approved", "concern"), "approve");
    expect(events.map((e) => e.event_name)).toEqual(["moderation_decided", "report_published"]);
    for (const e of events) {
      valid(e);
      expect(e.occurred_at).toBe("2026-09-06T12:00:00.000Z");
    }
    expect(events[0]!.properties).toEqual({
      report_id: REPORT,
      publication_revision_id: REVISION,
      decision: "approved",
      content_kind: "concern",
    });
  });

  it("approving a RESPONSE emits moderation_decided only", () => {
    const events = decisionEvents(decision("approved", "response"), "approve");
    expect(events.map((e) => e.event_name)).toEqual(["moderation_decided"]);
    expect(events[0]!.properties).toMatchObject({ content_kind: "response" });
  });

  it("requesting changes or rejecting never publishes, and never carries the reason", () => {
    const changes = decisionEvents(decision("changes_requested", "concern"), "request_changes");
    expect(changes.map((e) => e.event_name)).toEqual(["moderation_decided"]);
    expect(changes[0]!.properties).toMatchObject({ decision: "changes_requested" });
    expect(JSON.stringify(changes)).not.toContain("crop");

    const rejected = decisionEvents(decision("rejected", "concern"), "reject");
    expect(rejected[0]!.properties).toMatchObject({ decision: "rejected" });
  });

  it("emits nothing for a stored state outside the decision enum", () => {
    expect(
      decisionEvents({ ...decision("approved", "concern"), state: "withdrawn" }, "approve"),
    ).toEqual([]);
  });
});

describe("reviewer removal and flag resolution", () => {
  it("removal reports decision=removed for the hidden concern revision", () => {
    const event = valid(
      removalEvent({
        report_id: REPORT,
        removed: true,
        publication_revision_id: REVISION,
        removed_at: AT,
      }),
    );
    expect(event.properties).toEqual({
      report_id: REPORT,
      publication_revision_id: REVISION,
      decision: "removed",
      content_kind: "concern",
    });
  });

  it("removal with a null revision emits NOTHING", () => {
    expect(
      removalEvent({ report_id: REPORT, removed: true, publication_revision_id: null, removed_at: AT }),
    ).toBeNull();
    expect(
      removalEvent({
        report_id: REPORT,
        removed: true,
        publication_revision_id: REVISION,
        removed_at: null,
      }),
    ).toBeNull();
  });

  it("a flag resolution emits the removal event only when it removed content", () => {
    expect(
      valid(
        flagResolutionEvent({
          flag_id: OTHER,
          state: "handled",
          report_id: REPORT,
          removed: true,
          publication_revision_id: REVISION,
          removed_at: AT,
        }),
      ).properties,
    ).toMatchObject({ decision: "removed" });

    expect(
      flagResolutionEvent({
        flag_id: OTHER,
        state: "handled",
        report_id: REPORT,
        removed: false,
        publication_revision_id: REVISION,
        removed_at: null,
      }),
    ).toBeNull();
  });
});
