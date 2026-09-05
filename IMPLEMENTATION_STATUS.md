# FoodProof — Implementation status

Last updated: 5 September 2026. Session: https://claude.ai/code/session_01UxFbZr5dzBJkEnP2QsfNRe

This is the current-state record for whoever picks up next. Authoritative product
scope lives in `docs/` (start at `docs/FOODPROOF_BUILD_HANDOFF.md`); this file
tracks build progress only.

## Repository state

- Branch `t1-data` (off `main`). Remote `origin` = https://github.com/GaytriKhatwani/FoodProof.git
- **Not pushed** — T1 commits are local only; pushing needs authorization (AGENTS.md).
- Commits on `t1-data` (newest first):
  - `feat(t1)` — fictional seed + teardown scripts; robust test cleanup
  - `feat(t1)` — consented analytics proxy (structural; live ingestion at T4)
  - `feat(t1)` — publication, moderation, public feed, and flags
  - `feat(t1)` — demo boundary + persistence foundation (session, reports, evidence, history)
  - (T0 commits on `main`)

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

## Checks (last run 5 September 2026, against the live demo Supabase project)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Tests | `npm run test` | PASS (42/42: 4 live integration suites + unit/contract) |
| Seed | `scripts/seed.mjs` | PASS (published concern + simulated response + draft; idempotent) |
| Teardown | `scripts/teardown.mjs` | PASS (dry-run counts; guarded confirmed wipe) |

Live acceptance proven: two-tester isolation by guessed id; generic response for
unknown/expired/revoked codes; 5-attempt limiter; optimistic concurrency + idempotency;
guarded media (owner/reviewer-with-case only); preparation recompute; exact-snapshot
approval; reviewer-only decisions; withdrawal/removal hiding responses+assets; no stale
resurrection; public projection carries no owner ids or storage paths. Direct-client (RLS)
denial is enabled by the migration and asserted when `SUPABASE_ANON_KEY` is provided.

## Deferred / honest limitations

- **AI (T4)**: no AI routes; `confirm-facts` records `method` but there is no live
  extraction/drafting. The `AiAdapter` stub remains. The manual/template path works.
- **Analytics live ingestion (T4)**: the proxy validates + gates + derives the envelope,
  but delivery is best-effort and the placeholder Mixpanel token short-circuits it; real
  ingestion/region and wiring mutation-success events into each route are T4.
- **Atomicity**: multi-step operations (publication approval, withdraw, close/reopen,
  evidence changes) use guarded optimistic writes + idempotency rather than DB
  transactions (supabase-js has no multi-statement txn without an RPC). Invariants hold
  under the acceptance tests; promoting the hottest ones to Postgres functions is a
  hardening item.
- **Reviewed copies** strip metadata segments (EXIF/XMP/text/comments) rather than doing a
  full pixel re-encode (no native image dependency). Full transcode is a hardening item.
- Integration tests run sequentially against one shared remote project (`vitest`
  `fileParallelism:false`, 30s timeout) and take ~30–60s.

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

Push `t1-data` (needs authorization) and open a PR, or continue with T2/T3 UI against the
T1 API on their own branches. When inviting testers, the operator runs
`create-invitations.mjs` and distributes codes privately; `seed.mjs` populates the demo feed.
