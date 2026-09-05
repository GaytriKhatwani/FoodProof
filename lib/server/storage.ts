import "server-only";
import { notImplementedInT0 } from "./errors";

/**
 * Private evidence storage (FOODPROOF_TECHNICAL_SPEC.md §5).
 * Buckets `demo-originals` and `demo-reviewed` are private with no direct-client
 * access. Bytes are served through guarded media routes that re-check
 * permission; no long-lived URLs. Reviewed copies are re-encoded with image
 * metadata stripped. T1 implements; T0 freezes shapes.
 */

export const ORIGINALS_BUCKET = "demo-originals";
export const REVIEWED_BUCKET = "demo-reviewed";

export interface StoredObject {
  objectPath: string;
  bytes: number;
  mimeType: string;
}

export interface EvidenceStorage {
  /** Store an uploaded original in the private originals bucket. */
  putOriginal(
    reportId: string,
    file: { bytes: Uint8Array; mimeType: string },
  ): Promise<StoredObject>;
  /** Produce a sanitized (re-encoded, metadata-stripped) reviewed copy. */
  putReviewedCopy(sourceObjectPath: string): Promise<StoredObject>;
  /** Stream bytes for a guarded media route (never a public URL). */
  readBytes(objectPath: string): Promise<Uint8Array>;
  /** Remove a private original (published assets are never deleted here). */
  removeOriginal(objectPath: string): Promise<void>;
}

export const t0EvidenceStorage: EvidenceStorage = {
  putOriginal: () => notImplementedInT0("EvidenceStorage.putOriginal"),
  putReviewedCopy: () => notImplementedInT0("EvidenceStorage.putReviewedCopy"),
  readBytes: () => notImplementedInT0("EvidenceStorage.readBytes"),
  removeOriginal: () => notImplementedInT0("EvidenceStorage.removeOriginal"),
};
