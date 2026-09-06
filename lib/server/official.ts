import "server-only";

/**
 * Official (government) complaint destinations — server-owned allowlist
 * (FOODPROOF_TECHNICAL_SPEC.md §8; FOODPROOF_BUILD_TICKETS.md T5 A.3).
 *
 * FoodProof never files a complaint and never guesses a government address. The
 * "Open official portal" action may open ONLY a destination that a developer has
 * verified by hand and committed here. Deployment configuration
 * (`OFFICIAL_PORTAL_KEY`) does not carry a URL — it names one of these keys — so
 * a misconfiguration (a typo, an empty value, an unknown key) yields NO
 * destination and the action stays disabled, rather than sending a reporter to
 * an arbitrary or attacker-chosen URL. The verified URL lives here, in code.
 *
 * Verified 6 September 2026 in a browser: the key below resolves over HTTPS to
 * the FSSAI "Food Safety Connect" consumer grievance portal (Food Safety and
 * Standards Authority of India, Ministry of Health and Family Welfare,
 * Government of India), which offers "Proceed with Food related Grievance".
 */
const OFFICIAL_DESTINATIONS = {
  fssai_foscos_grievance: "https://foscos.fssai.gov.in/consumergrievance/",
} as const satisfies Record<string, `https://${string}`>;

export type OfficialDestinationKey = keyof typeof OFFICIAL_DESTINATIONS;

export interface OfficialDestination {
  /** Stable identifier emitted as `official_channel_opened.destination_key`. */
  key: OfficialDestinationKey;
  /** The verified, allowlisted government URL to open. */
  url: string;
}

function isKnownKey(value: string): value is OfficialDestinationKey {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_DESTINATIONS, value);
}

/**
 * The configured official destination, or null when none is set. Returns null
 * unless `OFFICIAL_PORTAL_KEY` names a key in the allowlist above — a value that
 * is unset, empty, or unknown is treated as "not configured", never as a URL.
 * Reads `process.env` directly (like `analyticsAudience`) so it does not require
 * the whole demo environment to validate.
 */
export function getOfficialDestination(): OfficialDestination | null {
  const key = process.env.OFFICIAL_PORTAL_KEY?.trim();
  if (!key || !isKnownKey(key)) return null;
  return { key, url: OFFICIAL_DESTINATIONS[key] };
}
