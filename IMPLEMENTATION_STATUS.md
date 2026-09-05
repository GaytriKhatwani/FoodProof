# FoodProof — Implementation status

Last updated: 6 September 2026. Session: https://claude.ai/code/session_01ELqpSrqVHfqtDqJ1SpRhpG

This is the current-state record for whoever picks up next. Authoritative product
scope lives in `docs/` (start at `docs/FOODPROOF_BUILD_HANDOFF.md`); this file
tracks build progress only.

## Repository state

- Remote `origin` = https://github.com/GaytriKhatwani/FoodProof.git
- **T1 closure work is on branch `fix/t1-closure`** (branched from `main`, not
  pushed, not merged). It is a security/data-integrity pass over the delivered T1:
  - `fix(t1)` — rename the secret key env var; test-only publishable key; real
    direct-client denial test
  - `feat(t1)` — transactional publication/withdrawal functions (migration 0003)
    + blocked-not-passed live gating
  - `docs(t1)` — closure status, deferred hardening, manifest refresh
- `main` carries T0 + the delivered T1 (merged from `t1-data` and pushed):
  - `docs(t1)` — record T1 delivered/verified; setup, scripts, honest limitations
  - `feat(t1)` — fictional seed + teardown scripts; robust test cleanup
  - `feat(t1)` — consented analytics proxy (structural; live ingestion at T4)
  - `feat(t1)` — publication, moderation, public feed, and flags
  - `feat(t1)` — demo boundary + persistence foundation (session, reports, evidence, history)
  - (T0 commits precede these on `main`)

## Done

- **T0 foundation** (scaffold + frozen contracts) — see git history; unchanged.
- **T1 data & persistence** — the `lib/server/` stubs are replaced with real
  implementations against a dedicated demo Supabase project, and the full data API
  lives under `app/api/**`. Verified live end-to-end (see Checks).
  - **Demo boundary**: invitation→session exchange (SHA-256 hashed codes/tokens,
    HttpOnly cookie, 8h session / 7d invite, server-resolved actor/role), persistent
    Supabase-backed invitation-attempt limiter (`record_access_attempt` RPC, 15-min
    tumbling window, 5 failed attempts, 429 + Retry-After, generic response for
    unknown/expired/revoked/blocked), same-origin guard, `/api/me` + analytics-consent.
  - **Reports**: create/patch/confirm-facts with optimistic `expected_version`,
    idempotency receipts, server-derived `preparation`, facts-invalidation; owner-only
    read models; canonical product matching/resolve mirroring the SQL `norm()` key.
  - **Evidence & storage**: content-sniffed uploads (magic bytes, 3 MB cap), private
    buckets, guarded media route, role patch with pending-review lock, guarded delete;
    reviewed-copy image **metadata stripping** (JPEG/PNG/WebP).
  - **Drafts & history**: deterministic complaint template + per-channel draft save;
    user-recorded submissions/updates with attachment + future-date validation;
    close/reopen appending audit updates.
  - **Publication & moderation**: immutable snapshot + sanitized asset copies from
    owned data (concern + response revisions), reviewer decisions under an optimistic +
    state guard, pointer move on approve, withdraw/remove/relink, flags + resolve;
    reviewer role enforced from the stored record in the service. Public feed/detail +
    reviewer queue/detail read only frozen snapshots; per-channel external status frozen
    at publish time. Guarded publication-asset media.
  - **Analytics**: `/api/analytics` proxy — server-derived envelope, consent gating,
    event-dictionary allowlist; best-effort delivery (structural; see Deferred).
  - **Operator scripts**: `setup-storage`, `create-invitations`, `seed` (§5a, drives the
    real API), `teardown` (ordered, guarded).
  - **Migrations**: `0001_init.sql` now includes explicit `service_role` grants;
    `0002_service_role_grants.sql` applies the same grants to an already-migrated project.
- **T1 closure (branch `fix/t1-closure`)**
  - **Secret key renamed**: `SUPABASE_SERVICE_ROLE_KEY` → **`SUPABASE_SECRET_KEY`**
    everywhere (`lib/server/env.ts`, `lib/server/supabase.ts`, `tests/helpers/live.ts`,
    all four operator scripts, `.env.example`, README and the specification/operations
    docs). Still server-only, still never `NEXT_PUBLIC_`. The Postgres role
    `service_role` in the SQL is a database role and is unchanged.
  - **`SUPABASE_PUBLISHABLE_KEY` is a TEST-ONLY setting** (`sb_publishable_...`, the
    key a browser would hold). It is deliberately absent from `ServerEnvSchema` and is
    never read from `lib/` or `app/`; only the direct-client denial test uses it.
    `SUPABASE_ANON_KEY` is gone.
  - **Direct-client (RLS + grants) denial is now really tested, or honestly skipped.**
    The old assertion was a placeholder that passed when no key was configured; that is
    removed. The suite seeds a row in every table it reads with the secret-key client,
    then proves a publishable-key client is refused: SELECT on `demo_access`,
    `demo_sessions`, `demo_access_attempts`, `reports`, `evidence`,
    `publication_revisions`, `publications`, `publication_assets`, `content_flags` and
    `operation_receipts`; INSERT/UPDATE/DELETE on `demo_access` and `reports` (with a
    secret-client check that nothing persisted); the `record_access_attempt` RPC (and no
    limiter counter created); uploads to both private buckets; and download /
    `createSignedUrl` / `list` of objects the secret client stored. Without the key the
    group is SKIPPED with the reason in its name — never counted as a pass.
  - **Transactional operations** — `supabase/migrations/0003_transactional_operations.sql`
    adds `plpgsql` functions (all SECURITY INVOKER, fixed `search_path`, EXECUTE granted
    to `service_role` only) that the service layer calls by RPC:
    `fp_decide_review` (revision state + publication pointer + audit in one transaction,
    refusing an approval of a revision that predates a withdrawal/removal, and refusing a
    response whose parent is not visible), `fp_withdraw_publication`, `fp_remove_content`,
    `fp_resolve_flag`, `fp_relink_product`, `fp_set_lifecycle` (close/reopen) and
    `fp_schema_version()`. Guard failures raise typed SQLSTATEs (FP403/FP404/FP409/FP422)
    that `lib/server/errors.ts` maps onto the existing `ApiError` codes, so request and
    response shapes, error codes and HTTP statuses are unchanged for callers. A missing
    function (PostgREST `PGRST202`) throws a clear error naming migration 0003; there is
    no silent fallback to the old step-by-step path.
  - **RPC EXECUTE lockdown** — 0001 left Postgres's and Supabase's defaults in place, so
    every function in `public` was reachable through PostgREST by a browser-held
    publishable key: `norm()` was callable by `anon` and returned a result, and
    `record_access_attempt()` was reachable (it failed only on the table privilege,
    leaking the internal reason). 0003 revokes EXECUTE from `public`/`anon`/`authenticated`
    on every function in the schema, grants it back to `service_role`, and stops new
    functions inheriting the PUBLIC default.
  - **Publication-request ordering** — selected evidence is validated *before* the
    revision row is written, so a rejected selection no longer leaves an orphan pending
    request that blocks the reporter's next attempt.

## Migration 0003 — APPLIED on the demo project

There is no Supabase CLI, `psql` or database connection string on the build machine, so
`supabase/migrations/0003_transactional_operations.sql` can only be applied by pasting it
into the **Supabase SQL Editor** of the demo project (README, Demo project setup, step 2).
It is idempotent.

**Status: applied.** `select fp_schema_version();` returns `3` on the demo project, and the
full suite below ran against the real functions. Any OTHER project (a fresh demo project, a
future deployment) must have 0003 applied before it works: the services that call the new
functions fail loudly naming the file — there is no fallback to the old path — and the
integration suites that exercise them report **BLOCKED** (skipped, with the reason in the
suite name and a console warning) rather than failing confusingly or passing. **A blocked
or skipped suite is not evidence that its assertions hold.**

## Checks (last run 6 September 2026, against the live demo Supabase project)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Build | `npm run build` | PASS |
| Tests | `npm run test` | PASS — 47 passed (47), 8 files passed, 0 skipped, 0 blocked |

Every suite executed live, with 0003 applied and `SUPABASE_PUBLISHABLE_KEY` set:

| Suite | Result |
|---|---|
| `tests/integration/boundary.test.ts` — demo boundary | 6 executed live |
| `tests/integration/boundary.test.ts` — direct client denial | 5 executed live |
| `tests/integration/publication.test.ts` | 5 executed live (against the 0003 functions) |
| `tests/integration/history.test.ts` | 6 executed live (close/reopen via `fp_set_lifecycle`) |
| `tests/integration/reports.test.ts` | 6 executed live |
| `tests/integration/evidence.test.ts` | 3 executed live |
| `tests/contracts.test.ts`, `tests/unit/*` | 15 executed |

`scripts/seed.mjs` and `scripts/teardown.mjs` were not re-run in this pass; they were
verified on `main`, and `seed.mjs` drives the publication path that now goes through 0003.

Live acceptance proven in this run: two-tester isolation by guessed id; generic response
for unknown/expired/revoked codes; 5-attempt limiter; optimistic concurrency +
idempotency; guarded media (owner/reviewer-with-case only); preparation recompute;
exact-snapshot approval; reviewer-only decisions; withdrawal and removal hiding responses
and assets; no stale resurrection; public projection carrying no owner ids or storage
paths. **Direct-client denial is proven live** with a real publishable-key client: tables,
INSERT/UPDATE/DELETE, the `record_access_attempt` RPC, `norm()` and every `fp_*` function,
uploads to both private buckets, and download / signed URL / list of stored objects.

## Deferred / honest limitations

- **AI (T4)**: no AI routes; `confirm-facts` records `method` but there is no live
  extraction/drafting. The `AiAdapter` stub remains. The manual/template path works.
- **Analytics live ingestion (T4)**: the proxy validates + gates + derives the envelope,
  but delivery is best-effort and the placeholder Mixpanel token short-circuits it; real
  ingestion/region and wiring mutation-success events into each route are T4.
- **Atomicity**: publication approval, withdrawal, reviewer removal, flag resolution with
  removal, relinking and close/reopen are now single database transactions (migration
  0003, above). The remaining multi-step writes still use guarded optimistic writes plus
  idempotency receipts; each one is listed below with what a partial failure leaves
  behind.
- **Reviewed copies** strip metadata segments (EXIF/XMP/text/comments) rather than doing a
  full pixel re-encode (no native image dependency). Full transcode is a hardening item.
- Integration tests run sequentially against one shared remote project (`vitest`
  `fileParallelism:false`, 30s timeout) and take ~30–60s.

## Deliberately deferred hardening (evaluated, not promoted to a transaction)

Every multi-step mutation in `lib/server/reports.ts`, `lib/server/history.ts`,
`lib/server/evidence.ts` and `lib/server/drafts.ts` was reviewed. The ones below stay as
guarded sequential writes **on purpose**; each entry states the steps, what a partial
failure actually leaves behind, and why that is recoverable rather than contradictory.

1. **Evidence upload** (`addEvidence`). Steps: store bytes in `demo-originals` → insert
   the `evidence` row → recompute and persist `preparation` (bumping the report version) →
   write the audit event. Partial failure after the row insert leaves `preparation` lagging
   the evidence and the caller sees a 503/409. Not contradictory: `preparation` is a
   *derived cache* whose single source of truth is `computePreparation` in
   `lib/server/preparation.ts`; reimplementing that rule in SQL would fork it. A stale
   `draft` is only under-reported readiness, nothing is public, and the next evidence or
   report write recomputes it. If the row insert fails after the upload, the code deletes
   the orphaned object explicitly.
2. **Evidence removal** (`removeEvidence`). Steps: delete the row → delete the private
   object (best effort) → recompute preparation/version → audit. If the recompute fails
   after the delete, the report can keep `preparation = 'ready'` while a required label
   role is gone. **Residual risk, stated plainly:** the reporter could then submit a
   publication request that the readiness rule would have blocked. It cannot publish
   anything false or unowned — every selected asset is still validated (owned, ready,
   label kind, image) and a reviewer approves only the exact frozen snapshot they see —
   and the next write to that report repairs the flag. Storage bytes can outlive the row;
   `scripts/teardown.mjs` and the test cleanup remove such orphans.
3. **Evidence role change** (`patchEvidenceRoles`). Steps: update `roles` → guarded
   recompute of the report's preparation/version (raises CONFLICT if the report changed) →
   audit → re-read. A CONFLICT can therefore be returned *after* the role change has
   landed. Not contradictory: roles are owner-editable metadata, the retry writes the same
   roles (idempotent) and recomputes preparation. Evidence that is a source of a pending
   review request is locked before any of this, so an already-frozen publication snapshot
   can never change.
4. **Report create / patch / confirm-facts** (`lib/server/reports.ts`). Steps: one guarded
   single-row write → internal `report_events` audit row. A failure between them leaves a
   consistent, version-guarded report and one missing *internal* audit entry, never a
   public claim. Retrying with the same `Idempotency-Key` returns CONFLICT ("already being
   processed"); with a new key the `expected_version` guard rejects the duplicate, so the
   write cannot land twice.
5. **Submission / update recording** (`recordSubmission`, `recordUpdate`) and
   **complaint-draft save** (`saveComplaintDraft`). Same shape: one guarded row write →
   audit event. The user-visible history *is* `submissions`/`updates`/`complaint_drafts`;
   `report_events` is an internal trail, and losing one entry there contradicts nothing.
   All three are user-recorded facts and make no external claim.
6. **Publication-request asset freezing** (`freezeAssets`). After validation, each selected
   image is re-encoded into `demo-reviewed` and inserted as a `publication_asset`, one at a
   time; Storage writes cannot join a database transaction, so this cannot be made fully
   atomic. A partial run leaves a pending revision with fewer assets than selected, plus
   orphaned reviewed objects. Not a contradictory public projection: nothing is public
   until a reviewer approves, and the reviewer sees exactly the frozen asset set that
   approval will publish. Nothing adds assets to a revision after the request.

## Not started (do not begin without assignment)

- **T2** reporter UI, **T3** community/moderation UI (build against the frozen
  `lib/contracts/` + the T1 API), then **T4** integrate + AI + live analytics, **T5**
  deployed pilot check.

## Open configuration (blocks the integrated pilot, not T1)

- AI provider/model + data terms + budget — owner provides **before T4**.
- Dedicated demo **Mixpanel** project/region/token for live ingestion (T4).
- Deployed `APP_ORIGIN` on Vercel; official FSSAI destination browser-verification;
  contact/moderator route; 30-day retention confirmation (T5).

## Exact next action

1. **Review and merge `fix/t1-closure`.** Migration 0003 is applied on the demo project and
   the full suite passes live against it (47/47), so the branch is ready. Rename
   `SUPABASE_SERVICE_ROLE_KEY` to `SUPABASE_SECRET_KEY` in every other environment (other
   local checkouts, any deployment) and add the test-only `SUPABASE_PUBLISHABLE_KEY`
   wherever the tests run. Apply 0003 to any further Supabase project before using it.
2. Then assign T2 (reporter UI) and T3 (community UI) on their own branches, built against
   the frozen `lib/contracts/` and the live T1 API (do not edit the shared
   schemas/migrations/lockfile). When inviting testers, the operator runs
   `create-invitations.mjs` and distributes codes privately; `seed.mjs` populates the demo
   feed (it drives the publication path, so it needs 0003 applied). T4 (AI + live Mixpanel)
   and T5 (deploy) follow the merges.
