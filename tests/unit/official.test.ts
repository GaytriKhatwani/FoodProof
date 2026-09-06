import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getOfficialDestination } from "@/lib/server/official";

/**
 * The official-destination allowlist (lib/server/official.ts, T5 A.3). The
 * deployment names a KEY, never a URL: the resolver returns a destination only
 * for a key that is present in the code allowlist, so a misconfiguration can
 * never send a reporter to an unvetted address.
 */
describe("getOfficialDestination", () => {
  const original = process.env.OFFICIAL_PORTAL_KEY;

  beforeEach(() => {
    delete process.env.OFFICIAL_PORTAL_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.OFFICIAL_PORTAL_KEY;
    else process.env.OFFICIAL_PORTAL_KEY = original;
  });

  it("returns null when unset", () => {
    expect(getOfficialDestination()).toBeNull();
  });

  it("treats an empty or whitespace value as unset", () => {
    process.env.OFFICIAL_PORTAL_KEY = "";
    expect(getOfficialDestination()).toBeNull();
    process.env.OFFICIAL_PORTAL_KEY = "   ";
    expect(getOfficialDestination()).toBeNull();
  });

  it("returns null for a key that is not in the allowlist", () => {
    process.env.OFFICIAL_PORTAL_KEY = "some_other_site";
    expect(getOfficialDestination()).toBeNull();
    // A prototype key must not be treated as a real destination.
    process.env.OFFICIAL_PORTAL_KEY = "toString";
    expect(getOfficialDestination()).toBeNull();
  });

  it("resolves the FSSAI grievance key to its verified https URL", () => {
    process.env.OFFICIAL_PORTAL_KEY = "fssai_foscos_grievance";
    const dest = getOfficialDestination();
    expect(dest).toEqual({
      key: "fssai_foscos_grievance",
      url: "https://foscos.fssai.gov.in/consumergrievance/",
    });
    expect(dest?.url.startsWith("https://")).toBe(true);
  });

  it("trims surrounding whitespace before matching a key", () => {
    process.env.OFFICIAL_PORTAL_KEY = "  fssai_foscos_grievance  ";
    expect(getOfficialDestination()?.key).toBe("fssai_foscos_grievance");
  });
});
