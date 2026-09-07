import { describe, expect, it } from "vitest";
import type { EvidenceRole } from "@/lib/contracts";
import { SAMPLE_NOTICE, buildTemplate, type TemplateEvidence } from "@/lib/server/drafts";

/**
 * The deterministic template must describe only the evidence the record
 * actually holds: a complaint that promises photographs or a receipt the
 * reporter never uploaded is a claim the reporter cannot back up.
 */

const report = {
  brand: "Sample Pantry",
  product_name: "Oat Crackers",
  variant: null,
  batch_number: "LOT-2041",
  observation_date: "2026-08-01",
  concern_text: "The pack claims gluten-free but lists oat flour.",
  claim_text: "Gluten-free",
  ingredients_text: "Oat flour, sunflower oil, salt",
  facts_confirmed_at: "2026-08-02T00:00:00.000Z",
};

const evidence = (roles: EvidenceRole[], receipt = false): TemplateEvidence => ({
  labelRoles: new Set(roles),
  receipt,
});

function evidenceSection(body: string): string {
  const start = body.indexOf("Evidence I can provide");
  const end = body.indexOf("\n\n", start);
  return body.slice(start, end);
}

describe("buildTemplate evidence section", () => {
  it("lists all three panels and the receipt only when they are all on the record", () => {
    const { body } = buildTemplate(report, "brand", evidence(["identity", "claim", "ingredients"], true));
    expect(evidenceSection(body)).toBe(
      "Evidence I can provide\n" +
        "- Photographs of the product identity, the label claim and the ingredient list.\n" +
        "- Purchase receipt.",
    );
  });

  it("names only the roles that ready label photographs cover", () => {
    const { body } = buildTemplate(report, "government", evidence(["claim"]));
    expect(evidenceSection(body)).toBe(
      "Evidence I can provide\n- Photographs of the label claim.",
    );
    const two = buildTemplate(report, "brand", evidence(["ingredients", "identity"]));
    expect(evidenceSection(two.body)).toContain(
      "- Photographs of the product identity and the ingredient list.",
    );
  });

  it("never promises a receipt that was not uploaded", () => {
    const { body } = buildTemplate(report, "brand", evidence(["identity", "claim", "ingredients"]));
    expect(body).not.toMatch(/receipt/i);
  });

  it("asks for photographs instead of claiming them when none are on the record", () => {
    const { body } = buildTemplate(report, "brand", evidence([]));
    expect(evidenceSection(body)).toBe(
      "Evidence I can provide\n" +
        "- [No label photographs are on this record yet. Add them before sending.]",
    );
  });

  it("keeps the batch number and the sample notice at both ends", () => {
    const { body } = buildTemplate(report, "brand", evidence(["identity"]));
    expect(body).toContain("- Batch: LOT-2041");
    expect(body.startsWith(SAMPLE_NOTICE)).toBe(true);
    expect(body.endsWith(SAMPLE_NOTICE)).toBe(true);
  });
});
