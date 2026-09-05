"use client";

import { useCallback, useRef } from "react";
import { idempotencyKey } from "@/lib/client/api";

/**
 * Idempotency-Key management for one form (see `lib/client/api.ts`): ONE key per
 * logical user action, reused across retries of that exact action so a repeated
 * request replays the original result instead of creating a duplicate record.
 *
 * `keyFor(signature)` returns the same key while the submitted content is
 * unchanged — a retry after a network failure — and mints a new one as soon as
 * the content changes, because a repeated key with a different body is a
 * deliberate 409. Call `reset()` after a success so the next action starts a new
 * logical operation.
 */
export function useActionKey(): [keyFor: (signature: string) => string, reset: () => void] {
  const state = useRef<{ signature: string | null; key: string }>({ signature: null, key: "" });

  const keyFor = useCallback((signature: string) => {
    if (state.current.signature !== signature) {
      state.current = { signature, key: idempotencyKey() };
    }
    return state.current.key;
  }, []);

  const reset = useCallback(() => {
    state.current = { signature: null, key: "" };
  }, []);

  return [keyFor, reset];
}
