import { describe, expect, it } from "vitest";
import {
  ClientAnalyticsEventRequest,
  ErrorCode,
  EventName,
  EventProperties,
  HTTP_STATUS_FOR_CODE,
  PublicationRequest,
  PublicFeedItem,
  PublicReport,
  ReportWriteRequest,
  SessionCreateRequest,
} from "@/lib/contracts";
import { REVIEWER, SAMPLE_REPORT_A, TESTER_A, TESTER_B } from "./fixtures";

describe("request schemas", () => {
  it("rejects unknown fields on report writes", () => {
    const bad = ReportWriteRequest.safeParse({
      product_name: "X",
      brand: "Y",
      expected_version: null,
      owner_access_id: "sneaky", // must be resolved server-side, never accepted
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a minimal valid report write", () => {
    const ok = ReportWriteRequest.safeParse({
      product_name: "X",
      brand: "Y",
      expected_version: null,
    });
    expect(ok.success).toBe(true);
  });

  it("requires an invitation code for session creation", () => {
    expect(SessionCreateRequest.safeParse({}).success).toBe(false);
    expect(
      SessionCreateRequest.safeParse({ invitation_code: "abc" }).success,
    ).toBe(true);
  });

  it("rejects unknown analytics event properties at the envelope level", () => {
    const bad = ClientAnalyticsEventRequest.safeParse({
      event_name: "report_saved",
      event_id: crypto.randomUUID(),
      occurred_at: new Date().toISOString(),
      properties: {},
      audience: "invited_pilot", // server-owned; client cannot set it
    });
    expect(bad.success).toBe(false);
  });

  it("requires selected images for a concern revision but allows none for a response revision", () => {
    const noParent = PublicationRequest.safeParse({
      expected_version: 0,
      consent: true,
      selected_evidence_ids: [],
    });
    expect(noParent.success).toBe(false);

    const withParent = PublicationRequest.safeParse({
      expected_version: 0,
      consent: true,
      selected_evidence_ids: [],
      source_update_id: crypto.randomUUID(),
    });
    expect(withParent.success).toBe(true);
  });
});

describe("public projection allowlist", () => {
  it("never surfaces owner-linked fields", () => {
    const parsed = PublicReport.parse({
      report_id: "11111111-0000-4000-8000-000000000001",
      publication_revision_id: "22222222-0000-4000-8000-000000000001",
      product_id: null,
      product_name: "Sample Pantry Crackers",
      brand: "Sample Pantry",
      variant: null,
      concern_summary: "Claim and ingredients appear to disagree.",
      observation_date: null,
      published_at: "2026-09-05T00:00:00.000Z",
      author_label: "Anonymous contributor",
      external_status: {
        brand: "no_submission_recorded",
        government: "no_submission_recorded",
        as_recorded_at: null,
      },
      confirmed_claim_text: null,
      confirmed_ingredients_text: null,
      approved_asset_ids: [],
      responses: [],
      // Fields below must not appear on a PublicReport:
      owner_access_id: "leak",
      object_path: "demo-originals/leak.jpg",
    });
    expect(parsed).not.toHaveProperty("owner_access_id");
    expect(parsed).not.toHaveProperty("object_path");
  });

  it("carries an optional thumbnail media id on a feed card, never a path", () => {
    const card = {
      report_id: "11111111-0000-4000-8000-000000000001",
      publication_revision_id: "22222222-0000-4000-8000-000000000001",
      product_id: null,
      product_name: "Sample Pantry Crackers",
      brand: "Sample Pantry",
      variant: null,
      concern_summary: "Claim and ingredients appear to disagree.",
      observation_date: null,
      published_at: "2026-09-05T00:00:00.000Z",
      author_label: "Anonymous contributor",
      external_status: {
        brand: "no_submission_recorded",
        government: "no_submission_recorded",
        as_recorded_at: null,
      },
    };

    // Additive: a projection built before the field existed still parses,
    // and so do an explicit id and an explicit "this revision has none".
    expect(PublicFeedItem.safeParse(card).success).toBe(true);
    expect(
      PublicFeedItem.parse({ ...card, thumbnail_asset_id: null }).thumbnail_asset_id,
    ).toBeNull();
    const withThumb = PublicFeedItem.parse({
      ...card,
      thumbnail_asset_id: "33333333-0000-4000-8000-000000000001",
    });
    expect(withThumb.thumbnail_asset_id).toBe("33333333-0000-4000-8000-000000000001");

    // A storage path can never take the place of a guarded media id.
    expect(
      PublicFeedItem.safeParse({
        ...card,
        thumbnail_asset_id: "demo-reviewed/leak.jpg",
      }).success,
    ).toBe(false);
  });

  it("describes approved assets with their label roles, keeping the id list intact", () => {
    const parsed = PublicReport.parse({
      report_id: "11111111-0000-4000-8000-000000000001",
      publication_revision_id: "22222222-0000-4000-8000-000000000001",
      product_id: null,
      product_name: "Sample Pantry Crackers",
      brand: "Sample Pantry",
      variant: null,
      concern_summary: "Claim and ingredients appear to disagree.",
      observation_date: null,
      published_at: "2026-09-05T00:00:00.000Z",
      author_label: "Anonymous contributor",
      external_status: {
        brand: "no_submission_recorded",
        government: "no_submission_recorded",
        as_recorded_at: null,
      },
      confirmed_claim_text: null,
      confirmed_ingredients_text: null,
      approved_asset_ids: ["33333333-0000-4000-8000-000000000001"],
      approved_assets: [
        { id: "33333333-0000-4000-8000-000000000001", roles: ["identity", "claim"] },
      ],
      responses: [],
    });
    expect(parsed.approved_asset_ids).toEqual(["33333333-0000-4000-8000-000000000001"]);
    expect(parsed.approved_assets?.[0]?.roles).toEqual(["identity", "claim"]);

    // Roles are the frozen label vocabulary, not free text.
    expect(
      PublicReport.safeParse({
        ...parsed,
        approved_assets: [
          { id: "33333333-0000-4000-8000-000000000001", roles: ["front_of_pack"] },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("envelope + dictionary completeness", () => {
  it("maps every error code to an HTTP status", () => {
    for (const code of ErrorCode.options) {
      expect(HTTP_STATUS_FOR_CODE[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it("defines properties for every analytics event", () => {
    const named = [...EventName.options].sort();
    const declared = Object.keys(EventProperties).sort();
    expect(declared).toEqual(named);
  });
});

describe("ownership fixtures", () => {
  it("gives testers distinct owner ids under a shared label", () => {
    expect(TESTER_A.accessId).not.toEqual(TESTER_B.accessId);
    expect(TESTER_A.label).toEqual(TESTER_B.label);
    expect(REVIEWER.role).toBe("reviewer");
    expect(SAMPLE_REPORT_A.community_visibility).toBe("private");
  });
});
