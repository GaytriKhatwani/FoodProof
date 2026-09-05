import type { DemoRole, ReportSummary } from "@/lib/contracts";

/**
 * Ownership test fixtures (frozen in T0 for the isolation tests T1 must pass).
 * These describe the OWNERSHIP dimension only — distinct access owners sharing a
 * visible label but never an owner id. No invitation codes or secrets live here
 * (AGENTS.md: codes never enter Git). Ids are static, obviously synthetic UUIDs.
 */

export interface AccessFixture {
  accessId: string;
  role: DemoRole;
  label: string;
}

export const TESTER_A: AccessFixture = {
  accessId: "00000000-0000-4000-8000-000000000001",
  role: "user",
  label: "user@foodproof",
};

export const TESTER_B: AccessFixture = {
  accessId: "00000000-0000-4000-8000-000000000002",
  role: "user",
  label: "user@foodproof",
};

export const REVIEWER: AccessFixture = {
  accessId: "00000000-0000-4000-8000-000000000003",
  role: "reviewer",
  label: "reviewer@foodproof",
};

/** A private draft owned by TESTER_A — TESTER_B must never read or edit it. */
export const SAMPLE_REPORT_A: ReportSummary = {
  report_id: "11111111-0000-4000-8000-000000000001",
  product_name: "Sample Pantry Crackers",
  brand: "Sample Pantry",
  variant: null,
  preparation: "draft",
  lifecycle: "open",
  community_visibility: "private",
  version: 0,
  updated_at: "2026-09-05T00:00:00.000Z",
};
