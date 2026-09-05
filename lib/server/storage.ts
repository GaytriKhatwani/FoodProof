import "server-only";
import { randomUUID } from "node:crypto";
import { getServiceClient } from "./supabase";
import { ApiError } from "./errors";
import { sniffMime, stripImageMetadata } from "./image";

/**
 * Private evidence storage (FOODPROOF_TECHNICAL_SPEC.md §5).
 * Buckets `demo-originals` and `demo-reviewed` are private with no direct-client
 * access. Object paths are stored bucket-prefixed so a guarded media route can
 * re-check permission and stream bytes — never a long-lived public URL. Reviewed
 * copies are re-emitted with image metadata stripped.
 */

export const ORIGINALS_BUCKET = "demo-originals";
export const REVIEWED_BUCKET = "demo-reviewed";

export interface StoredObject {
  objectPath: string;
  bytes: number;
  mimeType: string;
}

export interface EvidenceStorage {
  putOriginal(
    reportId: string,
    file: { bytes: Uint8Array; mimeType: string },
  ): Promise<StoredObject>;
  putReviewedCopy(sourceObjectPath: string): Promise<StoredObject>;
  readBytes(objectPath: string): Promise<Uint8Array>;
  removeOriginal(objectPath: string): Promise<void>;
}

function extFor(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

function parsePath(objectPath: string): { bucket: string; key: string } {
  const idx = objectPath.indexOf("/");
  if (idx <= 0) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", "Malformed storage path.");
  }
  return { bucket: objectPath.slice(0, idx), key: objectPath.slice(idx + 1) };
}

export const evidenceStorage: EvidenceStorage = {
  async putOriginal(reportId, file) {
    const supabase = getServiceClient();
    const key = `${reportId}/${randomUUID()}.${extFor(file.mimeType)}`;
    const { error } = await supabase.storage
      .from(ORIGINALS_BUCKET)
      .upload(key, Buffer.from(file.bytes), {
        contentType: file.mimeType,
        upsert: false,
      });
    if (error) throw error;
    return {
      objectPath: `${ORIGINALS_BUCKET}/${key}`,
      bytes: file.bytes.length,
      mimeType: file.mimeType,
    };
  },

  async putReviewedCopy(sourceObjectPath) {
    const supabase = getServiceClient();
    const original = await this.readBytes(sourceObjectPath);
    const mime = sniffMime(original) ?? "application/octet-stream";
    const sanitized = stripImageMetadata(original, mime);
    const { key: sourceKey } = parsePath(sourceObjectPath);
    const reportId = sourceKey.split("/")[0] ?? "unknown";
    const key = `${reportId}/${randomUUID()}.${extFor(mime)}`;
    const { error } = await supabase.storage
      .from(REVIEWED_BUCKET)
      .upload(key, Buffer.from(sanitized), { contentType: mime, upsert: false });
    if (error) throw error;
    return {
      objectPath: `${REVIEWED_BUCKET}/${key}`,
      bytes: sanitized.length,
      mimeType: mime,
    };
  },

  async readBytes(objectPath) {
    const supabase = getServiceClient();
    const { bucket, key } = parsePath(objectPath);
    const { data, error } = await supabase.storage.from(bucket).download(key);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  },

  async removeOriginal(objectPath) {
    const supabase = getServiceClient();
    const { bucket, key } = parsePath(objectPath);
    const { error } = await supabase.storage.from(bucket).remove([key]);
    if (error) throw error;
  },
};
