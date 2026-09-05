import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError } from "./errors";
import { getServiceClient } from "./supabase";
import { sha256Hex } from "./crypto";

/**
 * Idempotency receipts (FOODPROOF_TECHNICAL_SPEC.md §6, FOODPROOF_API_DETAILS.md).
 * State-changing mutations carry an `Idempotency-Key` UUID. The first request
 * reserves the key in `operation_receipts` (UNIQUE(actor_id, operation,
 * idempotency_key)); a retry with the same key and body replays the stored
 * response, while the same key with a different body is a 409 CONFLICT. Session
 * and consent responses are NOT stored here (no token/consent payload caching).
 */

const IdempotencyKey = z.string().uuid();

/** Require and validate the Idempotency-Key header for a mutation. */
export function requireIdempotencyKey(req: NextRequest): string {
  const raw = req.headers.get("idempotency-key");
  const parsed = IdempotencyKey.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_FAILED", "A valid Idempotency-Key header is required.", {
      fields: { "Idempotency-Key": "Must be a UUID." },
    });
  }
  return parsed.data;
}

/** Deterministic JSON for hashing a request body regardless of key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Run a mutation under an idempotency receipt. On first use it produces the
 * result and stores it; on an identical retry it replays the stored response;
 * on a reused key with a different body it throws CONFLICT.
 */
export async function withReceipt<T>(
  actorId: string,
  operation: string,
  key: string,
  requestBody: unknown,
  produce: () => Promise<T>,
): Promise<T> {
  const supabase = getServiceClient();
  const requestHash = sha256Hex(`${operation}:${stableStringify(requestBody)}`);

  const { error: insErr } = await supabase.from("operation_receipts").insert({
    actor_id: actorId,
    operation,
    idempotency_key: key,
    request_hash: requestHash,
  });

  if (insErr) {
    // 23505 = unique_violation: the key was already used by this actor/operation.
    if ((insErr as { code?: string }).code === "23505") {
      const { data: existing, error } = await supabase
        .from("operation_receipts")
        .select("request_hash, response_json")
        .eq("actor_id", actorId)
        .eq("operation", operation)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error) throw error;
      if (!existing || existing.request_hash !== requestHash) {
        throw new ApiError("CONFLICT", "Idempotency-Key was reused with a different request.");
      }
      if (existing.response_json != null) return existing.response_json as T;
      // Reserved but not yet completed: a retry is racing the first request.
      throw new ApiError("CONFLICT", "This request is already being processed.");
    }
    throw insErr;
  }

  const result = await produce();
  await supabase
    .from("operation_receipts")
    .update({ response_json: result as unknown as Record<string, unknown> })
    .eq("actor_id", actorId)
    .eq("operation", operation)
    .eq("idempotency_key", key);
  return result;
}
