import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { removeOrphanedCopies } from "@/lib/server/publication";

/**
 * Orphan cleanup after a failed publication request must never delete a
 * reviewed copy that a COMMITTED revision references — including the case
 * where the transaction committed but its reply was lost and the follow-up
 * lookup fails too. supabase-js reports a failed query as `{ data: null,
 * error }` rather than throwing, so this is exercised with a fake client and
 * no network.
 */

function fakeClient(result: { data: { object_path: string }[] | null; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        in: async () => result,
      }),
    }),
  } as unknown as Pick<SupabaseClient, "from">;
}

function recordingStorage() {
  const removed: string[] = [];
  return {
    removed,
    storage: {
      async removeObject(path: string) {
        removed.push(path);
      },
    },
  };
}

const FROZEN = [
  { source_evidence_id: "e1", object_path: "demo-reviewed/r1/a.png" },
  { source_evidence_id: "e2", object_path: "demo-reviewed/r1/b.png" },
];

describe("removeOrphanedCopies", () => {
  it("keeps every object when the reference lookup fails", async () => {
    const { removed, storage } = recordingStorage();
    await removeOrphanedCopies(
      fakeClient({ data: null, error: { message: "fetch failed" } }),
      FROZEN,
      storage,
    );
    expect(removed).toEqual([]);
  });

  it("removes only the objects no committed revision references", async () => {
    const { removed, storage } = recordingStorage();
    await removeOrphanedCopies(
      fakeClient({ data: [{ object_path: "demo-reviewed/r1/a.png" }], error: null }),
      FROZEN,
      storage,
    );
    expect(removed).toEqual(["demo-reviewed/r1/b.png"]);
  });

  it("removes everything when nothing references the copies", async () => {
    const { removed, storage } = recordingStorage();
    await removeOrphanedCopies(fakeClient({ data: [], error: null }), FROZEN, storage);
    expect(removed).toEqual(FROZEN.map((f) => f.object_path));
  });
});
