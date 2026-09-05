import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionService } from "@/lib/server/session";
import { ApiError } from "@/lib/server/errors";
import { MAX_FAILED_ATTEMPTS } from "@/lib/server/rate-limit";
import {
  cleanupStorage,
  createAccess,
  deleteAccess,
  deleteAttempts,
  hasLiveSupabase,
  liveDescribe,
  newCode,
  publishableClient,
  publishableKey,
  randomAddressHmac,
  samplePng,
  schemaVersion,
  sha256Hex,
  testClient,
} from "../helpers/live";

/**
 * Demo boundary (FOODPROOF_TECHNICAL_SPEC.md §2, §7). Proves the invitation ->
 * session exchange, distinct owner ids under a shared label, a generic response
 * whether a code is unknown/expired/revoked, the persistent 5-attempt limiter,
 * and direct-client (RLS) denial. Requires a live demo Supabase project.
 */
liveDescribe("demo boundary (live Supabase)", () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const usedHmacs: string[] = [];

  function freshHmac() {
    const h = randomAddressHmac();
    usedHmacs.push(h);
    return h;
  }

  afterAll(async () => {
    await deleteAttempts(client, usedHmacs);
    await deleteAccess(client, createdAccess);
  });

  async function expectApiError(p: Promise<unknown>): Promise<ApiError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return e as ApiError;
    }
    throw new Error("expected an ApiError but none was thrown");
  }

  it("exchanges a valid code for a resolvable session, then destroys it", async () => {
    const { accessId, code } = await createAccess(client, {
      role: "user",
      label: "user@foodproof",
    });
    createdAccess.push(accessId);

    const created = await sessionService.createSession(code, freshHmac());
    expect(created.actor.accessId).toBe(accessId);
    expect(created.actor.role).toBe("user");
    expect(created.actor.label).toBe("user@foodproof");
    expect(Date.parse(created.expiresAt)).toBeGreaterThan(Date.now());
    expect(created.cookie.httpOnly).toBe(true);
    expect(created.cookie.sameSite).toBe("lax");
    // No raw secret leaks: the cookie carries the token, response fields do not.
    expect(created.cookie.value.length).toBeGreaterThan(20);

    const resolved = await sessionService.resolveSession(created.cookie.value);
    expect(resolved?.actor.accessId).toBe(accessId);
    expect(resolved?.analytics.consent).toBe(false);

    await sessionService.destroySession(created.cookie.value);
    const gone = await sessionService.resolveSession(created.cookie.value);
    expect(gone).toBeNull();
  });

  it("gives two testers distinct owner ids under the same visible label", async () => {
    const a = await createAccess(client, { role: "user", label: "user@foodproof" });
    const b = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(a.accessId, b.accessId);

    const sa = await sessionService.createSession(a.code, freshHmac());
    const sb = await sessionService.createSession(b.code, freshHmac());
    expect(sa.actor.accessId).not.toBe(sb.actor.accessId);
    expect(sa.actor.label).toBe(sb.actor.label);
  });

  it("resolves the reviewer role from the stored record, not the request", async () => {
    const { accessId, code } = await createAccess(client, {
      role: "reviewer",
      label: "reviewer@foodproof",
    });
    createdAccess.push(accessId);
    const s = await sessionService.createSession(code, freshHmac());
    expect(s.actor.role).toBe("reviewer");
  });

  it("returns the same generic error for unknown, expired, and revoked codes", async () => {
    // Unknown code.
    const e1 = await expectApiError(
      sessionService.createSession(newCode(), freshHmac()),
    );
    expect(e1.code).toBe("UNAUTHENTICATED");

    // Expired invite.
    const expired = await createAccess(client, {
      role: "user",
      label: "user@foodproof",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    createdAccess.push(expired.accessId);
    const e2 = await expectApiError(
      sessionService.createSession(expired.code, freshHmac()),
    );
    expect(e2.code).toBe("UNAUTHENTICATED");
    expect(e2.message).toBe(e1.message);

    // Revoked invite.
    const revoked = await createAccess(client, {
      role: "user",
      label: "user@foodproof",
      revokedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    createdAccess.push(revoked.accessId);
    const e3 = await expectApiError(
      sessionService.createSession(revoked.code, freshHmac()),
    );
    expect(e3.code).toBe("UNAUTHENTICATED");
    expect(e3.message).toBe(e1.message);
  });

  it("blocks after five failed attempts in a window, even for a valid code", async () => {
    const hmac = freshHmac();
    const valid = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(valid.accessId);

    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      const e = await expectApiError(sessionService.createSession(newCode(), hmac));
      expect(e.code).toBe("UNAUTHENTICATED");
    }
    // Sixth attempt is rate limited...
    const blocked = await expectApiError(
      sessionService.createSession(newCode(), hmac),
    );
    expect(blocked.code).toBe("RATE_LIMITED");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    // ...and being over the limit hides code validity: a real code is also blocked.
    const stillBlocked = await expectApiError(
      sessionService.createSession(valid.code, hmac),
    );
    expect(stillBlocked.code).toBe("RATE_LIMITED");
  });

  it("clears the counter after a successful entry", async () => {
    const hmac = freshHmac();
    const valid = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(valid.accessId);

    // Four failures (under the limit), then a success clears the counter.
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      await expectApiError(sessionService.createSession(newCode(), hmac));
    }
    const ok = await sessionService.createSession(valid.code, hmac);
    expect(ok.actor.accessId).toBe(valid.accessId);

    // Counter cleared: five fresh failures are again allowed before blocking.
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      const e = await expectApiError(sessionService.createSession(newCode(), hmac));
      expect(e.code).toBe("UNAUTHENTICATED");
    }
  });

});

/**
 * Direct-client denial (FOODPROOF_TECHNICAL_SPEC.md §3, §7: "Direct Supabase
 * client access — No / No / No"). A REAL client holding only the project's
 * publishable key — the key a browser would have — must be refused every table
 * read, every table write, every RPC and every Storage operation.
 *
 * Every read is asserted against a row this suite SEEDED with the secret-key
 * client, so an empty result can never be mistaken for an empty table. Without
 * SUPABASE_PUBLISHABLE_KEY the whole group is SKIPPED with the reason in its
 * name; a skipped group is NOT evidence that denial holds.
 */
const APPLICATION_TABLES = [
  "demo_access",
  "demo_sessions",
  "demo_access_attempts",
  "reports",
  "evidence",
  "publication_revisions",
  "publications",
  "publication_assets",
  "content_flags",
  "operation_receipts",
] as const;

const directClientEnabled = hasLiveSupabase && Boolean(publishableKey);
if (hasLiveSupabase && !publishableKey) {
  console.warn(
    "[foodproof tests] SKIPPED: the direct-client (RLS) denial suite needs SUPABASE_PUBLISHABLE_KEY " +
      "(the demo project's sb_publishable_... key) in .env.local. This run does NOT prove direct-client denial.",
  );
}
const directClientTitle = directClientEnabled
  ? "direct client denial (publishable key, live Supabase)"
  : hasLiveSupabase
    ? "direct client denial (publishable key) — SKIPPED: SUPABASE_PUBLISHABLE_KEY not set"
    : "direct client denial (publishable key) — SKIPPED: SUPABASE_URL / SUPABASE_SECRET_KEY not set";

/**
 * EXECUTE denial for `norm()` and the migration-0003 functions only holds once
 * 0003 has revoked EXECUTE from public/anon/authenticated, so that one test is
 * BLOCKED (reported as skipped, never as passed) until 0003 is applied. Probed
 * at collection time so vitest lists it as skipped.
 */
const schema3 = directClientEnabled ? (await schemaVersion()) >= 3 : false;
if (directClientEnabled && !schema3) {
  console.warn(
    "[foodproof tests] BLOCKED: RPC EXECUTE denial for norm() and the fp_* functions is only " +
      "guaranteed once supabase/migrations/0003_transactional_operations.sql revokes EXECUTE from " +
      "public/anon/authenticated. Apply 0003 in the Supabase SQL Editor and re-run.",
  );
}

(directClientEnabled ? describe : describe.skip)(directClientTitle, () => {
  const client = testClient();
  const createdAccess: string[] = [];
  const createdReports: string[] = [];

  /** Seeded ids, so "no rows" is provably denial and not an empty table. */
  const seeded = {
    accessId: "",
    sessionId: "",
    reportId: "",
    evidenceId: "",
    revisionId: "",
    assetId: "",
    flagId: "",
    receiptId: "",
    attemptHmac: "",
    originalKey: "",
    reviewedKey: "",
  };

  beforeAll(async () => {
    const access = await createAccess(client, { role: "user", label: "user@foodproof" });
    createdAccess.push(access.accessId);
    seeded.accessId = access.accessId;

    const session = await client
      .from("demo_sessions")
      .insert({
        access_id: access.accessId,
        token_hash: sha256Hex(newCode()),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      })
      .select("id")
      .single();
    if (session.error) throw session.error;
    seeded.sessionId = session.data.id as string;

    seeded.attemptHmac = randomAddressHmac();
    const attempt = await client.from("demo_access_attempts").insert({
      address_hmac: seeded.attemptHmac,
      window_started_at: new Date().toISOString(),
      attempt_count: 1,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    if (attempt.error) throw attempt.error;

    const report = await client
      .from("reports")
      .insert({
        owner_access_id: access.accessId,
        product_name: "Sample Pantry Crackers",
        brand: "Sample Pantry",
        concern_text: "Fixture for the direct-client denial suite.",
      })
      .select("id")
      .single();
    if (report.error) throw report.error;
    seeded.reportId = report.data.id as string;
    createdReports.push(seeded.reportId);

    // Real private objects in both buckets, so a direct read has a real target.
    const png = Buffer.from(samplePng());
    seeded.originalKey = `${seeded.reportId}/${randomUUID()}.png`;
    seeded.reviewedKey = `${seeded.reportId}/${randomUUID()}.png`;
    for (const [bucket, key] of [
      ["demo-originals", seeded.originalKey],
      ["demo-reviewed", seeded.reviewedKey],
    ] as const) {
      const up = await client.storage.from(bucket).upload(key, png, {
        contentType: "image/png",
        upsert: false,
      });
      if (up.error) throw up.error;
    }

    const evidence = await client
      .from("evidence")
      .insert({
        report_id: seeded.reportId,
        object_path: `demo-originals/${seeded.originalKey}`,
        kind: "label",
        roles: ["identity"],
        mime_type: "image/png",
        bytes: png.length,
        upload_state: "ready",
      })
      .select("id")
      .single();
    if (evidence.error) throw evidence.error;
    seeded.evidenceId = evidence.data.id as string;

    const revision = await client
      .from("publication_revisions")
      .insert({
        report_id: seeded.reportId,
        revision: 1,
        payload: { report_id: seeded.reportId, brand: "Sample Pantry" },
        requested_by: access.accessId,
        state: "approved",
      })
      .select("id")
      .single();
    if (revision.error) throw revision.error;
    seeded.revisionId = revision.data.id as string;

    const publication = await client
      .from("publications")
      .insert({
        report_id: seeded.reportId,
        approved_revision_id: seeded.revisionId,
        visible: true,
      });
    if (publication.error) throw publication.error;

    const asset = await client
      .from("publication_assets")
      .insert({
        revision_id: seeded.revisionId,
        source_evidence_id: seeded.evidenceId,
        object_path: `demo-reviewed/${seeded.reviewedKey}`,
      })
      .select("id")
      .single();
    if (asset.error) throw asset.error;
    seeded.assetId = asset.data.id as string;

    const flag = await client
      .from("content_flags")
      .insert({ report_id: seeded.reportId, requested_by: access.accessId, reason: "fixture" })
      .select("id")
      .single();
    if (flag.error) throw flag.error;
    seeded.flagId = flag.data.id as string;

    const receipt = await client
      .from("operation_receipts")
      .insert({
        actor_id: access.accessId,
        operation: "boundary.fixture",
        idempotency_key: randomUUID(),
        request_hash: "fixture",
      })
      .select("id")
      .single();
    if (receipt.error) throw receipt.error;
    seeded.receiptId = receipt.data.id as string;
  });

  afterAll(async () => {
    await client.from("demo_access_attempts").delete().eq("address_hmac", seeded.attemptHmac);
    await cleanupStorage(client, createdReports);
    await deleteAccess(client, createdAccess);
  });

  function direct(): SupabaseClient {
    const c = publishableClient();
    if (!c) throw new Error("publishable client unavailable in an enabled suite");
    return c;
  }

  /**
   * A read is denied when it is rejected outright, or (fallback) returns no
   * rows at all — which is only meaningful because this suite seeded rows in
   * every table it reads.
   */
  function expectReadDenied(label: string, res: { data: unknown; error: unknown }): void {
    if (res.error) return;
    const rows = Array.isArray(res.data) ? res.data : res.data == null ? [] : [res.data];
    expect(rows, `${label}: direct client read returned rows (seeded data leaked)`).toHaveLength(0);
  }

  /** A write must be rejected outright — silence is never acceptable. */
  function expectWriteRejected(label: string, res: { error: unknown }): void {
    expect(res.error, `${label}: direct client write was NOT rejected`).not.toBeNull();
  }

  it("denies direct SELECT on every application table", async () => {
    const anon = direct();
    for (const table of APPLICATION_TABLES) {
      expectReadDenied(`select ${table}`, await anon.from(table).select("*").limit(5));
    }
    // The seeded rows do exist for the secret client, so "no rows" above is denial.
    const check = await client.from("reports").select("id").eq("id", seeded.reportId);
    expect(check.data).toHaveLength(1);
  });

  it("denies direct INSERT / UPDATE / DELETE on demo_access and reports", async () => {
    const anon = direct();
    const intrudedHash = sha256Hex(newCode());

    expectWriteRejected(
      "insert demo_access",
      await anon.from("demo_access").insert({
        token_hash: intrudedHash,
        role: "reviewer",
        label: "reviewer@foodproof",
      }),
    );
    expectWriteRejected(
      "update demo_access",
      await anon.from("demo_access").update({ role: "reviewer" }).eq("id", seeded.accessId),
    );
    expectWriteRejected(
      "delete demo_access",
      await anon.from("demo_access").delete().eq("id", seeded.accessId),
    );

    expectWriteRejected(
      "insert reports",
      await anon.from("reports").insert({
        owner_access_id: seeded.accessId,
        product_name: "Injected",
        brand: "Injected",
      }),
    );
    expectWriteRejected(
      "update reports",
      await anon.from("reports").update({ brand: "Injected" }).eq("id", seeded.reportId),
    );
    expectWriteRejected(
      "delete reports",
      await anon.from("reports").delete().eq("id", seeded.reportId),
    );

    // Nothing was persisted: verified with the secret client.
    const intruder = await client.from("demo_access").select("id").eq("token_hash", intrudedHash);
    expect(intruder.data ?? []).toHaveLength(0);
    const access = await client
      .from("demo_access")
      .select("id, role")
      .eq("id", seeded.accessId)
      .maybeSingle();
    expect(access.data?.role).toBe("user");
    const injected = await client.from("reports").select("id").eq("brand", "Injected");
    expect(injected.data ?? []).toHaveLength(0);
    const report = await client
      .from("reports")
      .select("id, brand")
      .eq("id", seeded.reportId)
      .maybeSingle();
    expect(report.data?.brand).toBe("Sample Pantry");
  });

  it("denies the record_access_attempt RPC and creates no limiter counter", async () => {
    const anon = direct();
    const probeHmac = randomAddressHmac();
    const res = await anon.rpc("record_access_attempt", {
      p_address_hmac: probeHmac,
      p_window: new Date().toISOString(),
      p_expires: new Date(Date.now() + 900_000).toISOString(),
    });
    expect(res.error, "record_access_attempt was callable by the direct client").not.toBeNull();

    const rows = await client
      .from("demo_access_attempts")
      .select("id")
      .eq("address_hmac", probeHmac);
    expect(rows.data ?? [], "a limiter counter was mutated by the direct client").toHaveLength(0);
  });

  it.skipIf(!schema3)(
    schema3
      ? "denies the norm and migration-0003 RPCs to the direct client"
      : "denies the norm and migration-0003 RPCs to the direct client — BLOCKED: migration 0003_transactional_operations.sql not applied (it adds the EXECUTE revokes)",
    async () => {
      const anon = direct();
      const calls: Array<[string, Record<string, unknown>]> = [
        ["norm", { txt: " Sample  Pantry " }],
        ["fp_schema_version", {}],
        ["fp_decide_review", {
          p_revision_id: seeded.revisionId,
          p_reviewer: seeded.accessId,
          p_expected_version: 0,
          p_action: "approve",
          p_reason: null,
        }],
        ["fp_withdraw_publication", { p_report_id: seeded.reportId, p_actor: seeded.accessId }],
        ["fp_remove_content", {
          p_report_id: seeded.reportId,
          p_reviewer: seeded.accessId,
          p_reason: "probe",
        }],
        ["fp_resolve_flag", {
          p_flag_id: seeded.flagId,
          p_reviewer: seeded.accessId,
          p_note: "probe",
          p_remove: true,
        }],
        ["fp_relink_product", {
          p_report_id: seeded.reportId,
          p_reviewer: seeded.accessId,
          p_product_id: randomUUID(),
          p_reason: "probe",
        }],
        ["fp_set_lifecycle", {
          p_report_id: seeded.reportId,
          p_owner: seeded.accessId,
          p_to: "closed_by_reporter",
          p_audit_kind: "closed",
          p_summary: "probe",
          p_close_reason: "probe",
        }],
      ];
      for (const [fn, args] of calls) {
        const res = await anon.rpc(fn, args);
        expect(res.error, `${fn} was callable by the direct client`).not.toBeNull();
      }

      // No state changed: the publication is still visible and the flag still open.
      const pub = await client
        .from("publications")
        .select("visible")
        .eq("report_id", seeded.reportId)
        .maybeSingle();
      expect(pub.data?.visible).toBe(true);
      const flag = await client
        .from("content_flags")
        .select("state")
        .eq("id", seeded.flagId)
        .maybeSingle();
      expect(flag.data?.state).toBe("open");
    },
  );

  it("denies direct Storage uploads to both private buckets", async () => {
    const anon = direct();
    const png = Buffer.from(samplePng());
    for (const bucket of ["demo-originals", "demo-reviewed"] as const) {
      const key = `${seeded.reportId}/intruder-${randomUUID()}.png`;
      const res = await anon.storage
        .from(bucket)
        .upload(key, png, { contentType: "image/png", upsert: false });
      expect(res.error, `${bucket}: direct upload was NOT rejected`).not.toBeNull();

      const listed = await client.storage.from(bucket).list(seeded.reportId);
      const names = (listed.data ?? []).map((o) => o.name);
      expect(names.some((n) => n.startsWith("intruder-"))).toBe(false);
    }
  });

  it("denies direct Storage download, signed URLs and listing of stored objects", async () => {
    const anon = direct();
    for (const [bucket, key] of [
      ["demo-originals", seeded.originalKey],
      ["demo-reviewed", seeded.reviewedKey],
    ] as const) {
      const download = await anon.storage.from(bucket).download(key);
      expect(download.error, `${bucket}: direct download returned bytes`).not.toBeNull();
      expect(download.data, `${bucket}: direct download returned bytes`).toBeNull();

      const signed = await anon.storage.from(bucket).createSignedUrl(key, 60);
      expect(signed.error, `${bucket}: direct createSignedUrl succeeded`).not.toBeNull();

      const listed = await anon.storage.from(bucket).list(seeded.reportId);
      const names = (listed.data ?? []).map((o) => o.name);
      const target = key.slice(key.indexOf("/") + 1);
      expect(
        listed.error !== null || !names.includes(target),
        `${bucket}: direct list exposed a stored object`,
      ).toBe(true);
    }
  });
});
