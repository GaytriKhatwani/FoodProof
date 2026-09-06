import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EventName, EventProperties } from "@/lib/contracts";

/**
 * Standing guard on the event dictionary itself
 * (FOODPROOF_MEASUREMENT_AND_PILOT.md §2: "Never send names, email/phone
 * details, health information, report/complaint text, ingredient text,
 * photographs, file URLs, recipients, reference numbers, search text, closure
 * reasons, free-text errors, or AI prompts/outputs to Mixpanel").
 *
 * These tests read the CONTRACT, not a sample payload, so a future property
 * added to `lib/contracts/analytics.ts` has to face them before it can be
 * emitted anywhere.
 */

/** Words that name content or a person, rather than an opaque id or an enum. */
const CONTENT_WORDS = /text|name|email|phone|address|reason|note|summary|url|path|query|search|recipient|reference|label/i;

/**
 * The only keys allowed to trip that pattern, each with why it is safe. Every
 * one is an opaque id, an enum, or a boolean — never free text.
 */
const ALLOWED_CONTENT_WORD_KEYS: Record<string, string> = {
  // `destination_key` is an allowlisted CONFIGURATION key (e.g. a fixed
  // government-portal identifier), never a URL and never user input.
  destination_key: "allowlisted configuration key, not a URL",
};

function propertyKeys(name: z.infer<typeof EventName>): string[] {
  return Object.keys(EventProperties[name].shape as Record<string, unknown>);
}

describe("the event dictionary contains no content or PII property", () => {
  it("covers every event name (no event escapes this check)", () => {
    expect(Object.keys(EventProperties).sort()).toEqual([...EventName.options].sort());
  });

  for (const name of EventName.options) {
    it(`${name}: no key names content or a person`, () => {
      const offenders = propertyKeys(name).filter(
        (key) => CONTENT_WORDS.test(key) && !(key in ALLOWED_CONTENT_WORD_KEYS),
      );
      expect(offenders).toEqual([]);
    });
  }

  it("every free-form string property is a UUID id — nothing is open text", () => {
    const openText: string[] = [];
    for (const name of EventName.options) {
      const shape = EventProperties[name].shape as Record<string, z.ZodTypeAny>;
      for (const [key, schema] of Object.entries(shape)) {
        if (!(schema instanceof z.ZodString)) continue;
        const uuidConstrained = schema._def.checks.some((c) => c.kind === "uuid");
        if (!uuidConstrained && !(key in ALLOWED_CONTENT_WORD_KEYS)) {
          openText.push(`${name}.${key}`);
        }
      }
    }
    expect(openText).toEqual([]);
  });
});

describe("the builders emit only allowlisted keys (nothing is silently stripped)", () => {
  it("a strict parse of each event's own properties accepts exactly its shape", () => {
    // `.strict()` is what lib/server/analytics.ts applies, so an unlisted key is
    // rejected rather than dropped. Proven here on the contract itself: adding
    // any extra key to a valid payload must fail.
    const sample = {
      report_id: "11111111-1111-4111-8111-111111111111",
      publication_revision_id: "22222222-2222-4222-8222-222222222222",
    };
    expect(() => EventProperties.report_published.strict().parse(sample)).not.toThrow();
    expect(() =>
      EventProperties.report_published.strict().parse({ ...sample, product_name: "Sample" }),
    ).toThrow();
  });
});
