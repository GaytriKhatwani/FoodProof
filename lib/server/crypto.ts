import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Token generation and hashing for the demo entry boundary
 * (FOODPROOF_TECHNICAL_SPEC.md §2). Invitation codes and session tokens are
 * high-entropy random strings; only their SHA-256 hashes are ever persisted.
 * The raw values are shown once (invitation codes to the operator, session
 * tokens as an HttpOnly cookie) and never stored or logged.
 */

/** High-entropy, URL-safe random token (raw; never stored). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex digest used as the stored lookup key for a raw token/code. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
