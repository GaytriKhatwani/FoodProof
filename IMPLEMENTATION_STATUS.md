# FoodProof — Implementation status

Last updated: 6 September 2026. Session: https://claude.ai/code/session_01ELqpSrqVHfqtDqJ1SpRhpG

This is the current-state record for whoever picks up next. Authoritative product
scope lives in `docs/` (start at `docs/FOODPROOF_BUILD_HANDOFF.md`); this file
tracks build progress only. **Stop point: T2 and T3 are merged; T4 and T5 have not
started (owner instruction: hand off here).**

## Repository state

- Remote `origin` = https://github.com/GaytriKhatwani/FoodProof.git
- **Pushed**: `main` == `origin/main` at `d81ebeb`, working tree clean.
- Merged into `main` on 6 September 2026, in order (each verified before merge):
  1. `fix/t1-closure` — secret-key rename, test-only publishable key, real direct-client
     denial test, transactional functions (migration 0003).
  2. `feat/shared-client-e2e` — typed client API adapter, session hook, client analytics
     adapter, pilot middleware gate, Playwright harness (the only dependency change).
  3. `feat/review-contract-additions` (819347b) — review detail returns `version`; queue
     items carry `brand`/`product_name`.
  4. `fix/response-attachment-optional` (bd98bd1) — response revisions may be requested
     with no attachment; concern revisions still need images.
  5. `fix/no-store-supabase-fetch` (d41f0f9) — Supabase reads never served from Next's
     Data Cache; `tests/e2e/api-freshness.spec.ts` guards it.
  6. `fix/seed-real-image` (d1bd463) — seed uploads the fictional label photograph; valid
     sample PNG; `seed.mjs --reset`; `tests/e2e/media-decodes.spec.ts`.
  7. `fix/idempotency-release-on-failure` (5aeda9a) — a failed mutation releases its
     receipt so an identical retry succeeds.
  8. `fix/seed-order` (509314f) — seed records the brand submission before publishing so
     the frozen public status reads correctly.
  9. `feat/t2-reporter-ui` (merge aa2cd48) — reporter journey, after independent review
     and repair.
  10. `feat/t3-community-review-ui` (fast-forward to d81ebeb) — public home, entry, shell,
      feed, concern detail, reviewer UI, after independent review and repair.
- Branches for merged work still exist locally; the only remaining worktree is
  `../FoodProof-worktrees/t3-community` (merged; safe to remove). Worktrees live under
  `../FoodProof-worktrees/<name>` with their own `npm ci` and a copied `.env.local` whose
  `APP_ORIGIN` sets that worktree's dev port (the same-origin check compares against it).

## Done

- **T0 foundation** and **T1 data & persistence** — unchanged from the T1 record (demo
  boundary, reports, evidence + private storage + guarded media, drafts + history,
  publication/moderation/feed/flags, analytics proxy, operator scripts, migrations
  0001/0002). See git history.
- **T1 closure** — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY` (server-only);
  `SUPABASE_PUBLISHABLE_KEY` is a test-only setting used by the direct-client denial suite
  (skipped with a stated reason when absent, never a placeholder pass). Migration
  `0003_transactional_operations.sql` (APPLIED on the demo project; `select
  fp_schema_version()` returns 3) makes approval + pointer, withdrawal, removal, flag
  resolution, relink and close/reopen single transactions, refuses stale approvals that
  would resurrect withdrawn content, and revokes function EXECUTE from
  public/anon/authenticated (`norm()` and `record_access_attempt()` were callable by anon
  before). Deliberately deferred hardening (evidence upload/removal/role change, report
  writes, submission/update/draft audit rows, asset freezing) is documented in the
  section of that name below.
- **Shared client + browser-test harness** — `lib/client/api.ts` (uniform envelope,
  `ClientApiError`, one `Idempotency-Key` per logical action reused on retry, multipart
  upload, guarded media URL helpers), `lib/client/session.tsx` (`useSession()`),
  `lib/analytics/index.ts` (`clientAnalytics.track`, fire-and-forget), `middleware.ts` +
  `lib/session-cookie.ts` (cookie gate on `/pilot/:path+`), Playwright (`npm run
  test:e2e`; origin from `APP_ORIGIN`; `desktop` 1280×800 and `mobile` 360×740).
- **T2 reporter journey** (`app/pilot/(shell)/reports/**`, `components/reporter/**`,
  `tests/e2e/reporter-*.spec.ts`): My reports; four-step guided editor with incomplete
  private saving, evidence upload/roles/removal, manual fact confirmation with
  reconfirmation-after-change, server-driven readiness, manual product linking,
  from-concern identity-only prefill (`/pilot/reports/new?from_concern=<reportId>`);
  community preview with required unchecked consent, review request, withdrawal,
  resubmission; action preparation with deterministic template, per-channel editable
  drafts, copy (distinct from sending), brand `mailto:` handoff with user-confirmed
  address, official destination as a labelled non-functional placeholder, separate
  "record that you sent it"; private timeline with separate brand/government histories,
  responses (optional attachment), follow-ups, close-with-reason/reopen; recovery states
  (failed save keeps inputs; stale → reload; locked-by-pending-review and
  already-pending conflicts have their own honest copy; 401/503 explicit; no local
  fallback). Client events: `report_started`, `complaint_text_copied`,
  `brand_email_opened`, `flow_error_shown`.
- **T3 community and moderation** (`app/page.tsx`, `app/pilot/page.tsx`,
  `app/pilot/(shell)/layout.tsx`, `app/pilot/(shell)/{feed,concerns,review}/**`,
  `components/{shell,community,review}/**`, `public/illustrative-label.jpg`,
  `tests/e2e/{entry,community,review}-*.spec.ts`): public home (no pilot API request;
  fictional label photograph with "Illustrative example" caption); invitation entry
  (masked code, generic failure, 429 wait, unavailable state, `next` only within
  `/pilot/`, role-based destination, equal allow/decline analytics consent, no
  login/OTP/Google/role UI); pilot shell (skip link, nav Feed / My reports / Review
  [reviewer only], test-identity label, analytics preference control, Exit; loading /
  session-ended / backend-unavailable states); feed with search, cursor pagination,
  honest empty states; concern detail with guarded images, zoom viewer, frozen
  per-channel status, reviewed responses, private correction flag, "report this product
  independently"; reviewer queue and detail with the exact frozen snapshot, checklists,
  decisions with required reasons, `expected_version` from the loaded revision, 409
  reload state, flag resolution, removal, relink; forbidden state for non-reviewers.
  Client events: `demo_entered`, `feed_viewed`, `feed_search_completed`,
  `feed_report_viewed`, `flow_error_shown`.
- **Independent reviews** of T2 and T3 (product intent, exposure, state honesty, API
  compatibility, recovery, accessibility, scope) found no blockers; all findings were
  repaired on the owning branch before merge.

## Checks (merged tree `d81ebeb`, 6 September 2026, live demo Supabase project)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS (orchestrator run on `main`) |
| Lint | `npm run lint` | PASS (orchestrator run on `main`) |
| Build | `npm run build` | PASS (orchestrator run on `main`) |
| Tests | `npm run test` | PASS — 51 passed (51), 8 files, 0 skipped, 0 blocked (orchestrator run on `main`) |
| Browser tests | `npm run test:e2e` | PASS — 114 passed (desktop + 360 px) on the T3 branch at the identical tree, run by the T3 agent; the orchestrator's own full run on `main` was interrupted by a tooling failure and must be re-run at the start of the next session (see Exact next action) |

Live acceptance covered by the suites: everything in the T1 record plus direct-client
denial with a real publishable-key client (tables, writes, RPCs, both buckets), read-your-
writes through the real Next runtime (consent, feed after approval, withdrawn media stop
serving), served images decode in Chromium, attachment-free response sharing,
failed-then-retried idempotent mutations, the full moderation loop in the UI (approve →
appears in feed → flagged → resolved → withdrawn → unavailable), stale-review recovery,
forbidden state for non-reviewers, middleware redirect, public home makes no pilot request.

## Deployment (owner-provided)

- https://food-proof.vercel.app — Vercel Git integration deploys `main` automatically; the
  owner confirmed that is acceptable while nobody uses it.
- `GET /api/health` on the deployment reports every config group present except `ai`;
  the same-origin check accepts the deployed origin and rejects foreign origins; invitation
  exchange reaches the database. `MIXPANEL_TOKEN` there is the owner's NEW demo Mixpanel
  project (also in the local `.env.local`); no Mixpanel service account exists, so
  ingestion read-back is verified by the owner in Live View. AI variables are not set on
  Vercel yet.

## Demo Supabase project state

Migrations 0001–0003 applied. `demo_access` holds exactly `seed@foodproof` and
`seed-reviewer@foodproof`; one published fictional concern (real label photograph, frozen
brand status `submission_reported`) with one reviewed simulated response, and one
unpublished draft. Re-seed with `node --env-file=.env.local scripts/seed.mjs --reset`
(dev server running; deletes only the two seed-labelled rows and their data). Create tester
codes with `scripts/create-invitations.mjs` and distribute privately.

## Contract rulings made during Phase 2 (integration owner)

1. Review detail returns `version`; queue items carry `brand`/`product_name` (additive).
2. `PublicationRequest.selected_evidence_ids` may be empty for RESPONSE revisions only
   (API supplement: response evidence is optional); concern revisions still need images.
3. A private draft's first save needs product name + brand (NOT NULL in the frozen schema;
   the technical specification governs data contracts); everything else may stay
   incomplete. No schema change.
4. Server-owned mutation-success analytics events are emitted by nobody yet; clients never
   emit them. This is T4 scope.
5. UI code calls the API only through `lib/client/api.ts`; ownership boundaries held for
   both UI branches (verified by diff).

## Handoff notes (known gaps recorded, not fixed)

- `PublicFeedItem` carries no asset ids (no card thumbnail); `PublicReport` asset ids carry
  no roles (alt text is positional and generic).
- `GET /api/feed/:id` returns one 404 for never-published, withdrawn and removed; the UI
  shows one "not available" state (distinguishing would leak moderation outcomes).
- `ReviewRequestState` has no `source_update_id`, so response review requests are listed
  by date on the timeline; `updates` require a recorded submission first.
- Reviewer API exposes only frozen copies, so review detail has one evidence pane, not a
  private-source pane. Moderation actions state that they apply to whatever is currently
  published, since the review payload cannot say whether a publication is visible.
- `flow_error_shown` `error_code` mapping differs slightly between reporter
  (`components/reporter/failure.ts`) and community (`components/shell/flow-error.ts`)
  screens (`network` vs `unavailable` for `DEPENDENCY_UNAVAILABLE`); align in one place at T4.
- The server does not validate its own public projection; an older frozen payload lacking
  `external_status` once crashed the feed (UI now degrades to "Not recorded in this
  version"; the example was re-seeded). Consider projection validation at T4.
- No upload percentage (fetch has no progress events); indeterminate status is shown.
- The official destination link stays a labelled placeholder until the owner verifies the
  destination in a browser at T5; `official_channel_opened` is therefore never emitted.
- Sessions of a `user` invitation can reach `/pilot/review` only to receive the forbidden
  state; the API denies with 403 independently.

## Deferred / honest limitations

- **AI (T4)**: no AI routes; `AiAdapter` stub remains; manual/template path works and is
  mandatory. The owner has chosen a provider, model tier, effort level and a hard spend cap
  (recorded outside these documents per the provider-neutral convention: see the
  gitignored `.env.local` comment and the orchestrator's notes). Live extraction and
  drafting are required for full phase-one acceptance (A05).
- **Analytics live ingestion (T4)**: the proxy validates, gates on consent and derives the
  envelope; delivery to the new demo Mixpanel project is unverified; server-owned
  mutation-success events are not emitted anywhere.
- **Atomicity**: see "Deliberately deferred hardening".
- **Reviewed copies** strip metadata rather than re-encoding pixels.
- Integration tests run sequentially against one shared remote project (~100 s); the full
  browser suite takes ~7 minutes.

## Deliberately deferred hardening (evaluated, not promoted to a transaction)

1. **Evidence upload** — store bytes → insert row → recompute `preparation` → audit. A
   partial failure leaves `preparation` lagging (derived cache; single source of truth in
   `lib/server/preparation.ts`); the next write recomputes it; an orphaned object is
   deleted explicitly if the row insert fails.
2. **Evidence removal** — delete row → delete object (best effort) → recompute → audit.
   Residual risk: `preparation` can stay `ready` after a required role is gone until the
   next write; nothing false or unowned can be published (assets are validated and the
   reviewer approves only the frozen snapshot). Orphaned bytes are removed by teardown/test
   cleanup.
3. **Evidence role change** — update → guarded recompute (CONFLICT if the report changed)
   → audit; a CONFLICT can follow a landed role change; retry is idempotent; pending-review
   evidence is locked first.
4. **Report create / patch / confirm-facts** — one guarded write → internal audit row; a
   missing audit row contradicts nothing; the version guard prevents double writes.
5. **Submission / update / draft save** — same shape; the user-visible record is the row.
6. **Publication-request asset freezing** — Storage writes cannot join a transaction; a
   partial run leaves a pending revision with fewer assets; nothing is public until
   approval and the reviewer sees exactly the frozen set.

## Not started (do not begin without assignment)

- **T4** integrate + AI + live analytics; **T5** deployed guarded-pilot check.

## Open configuration

- AI variables on Vercel (`AI_PROVIDER`, `AI_PROVIDER_API_KEY`, model) — owner sets at T4/T5.
- Mixpanel read-back (no service account) — owner verifies in Live View during T4.
- Official FSSAI destination browser-verification; contact/moderator route; 30-day
  retention confirmation (T5).

## Exact next action (continuation prompt for the next session)

1. Re-run the full browser suite on `main` (`npm run test:e2e`, port 3000 free,
   `.next/cache/fetch-cache` cleared, dev server stopped) and record the result here; the
   expected outcome is 114 passed on both viewports. Remove the merged worktree
   `../FoodProof-worktrees/t3-community`.
2. **T4** on a new worktree from `main`: add `@anthropic-ai/sdk`-style provider code only
   through the frozen `AiAdapter` interface (`lib/server/ai.ts`) using the owner's chosen
   provider/model/effort (see `.env.local` comment; keep these documents neutral); map
   `AI_PROVIDER` / `AI_PROVIDER_API_KEY` in `lib/server/env.ts`; implement
   `POST /api/reports/:id/ai/extract` and `/ai/draft` per `docs/FOODPROOF_API_DETAILS.md`
   with ownership checks, base64 image input from owned evidence only, structured output
   validated by Zod, timeout and output caps, a durable spend ledger enforcing the owner's
   hard cap (new migration `0004`, applied by the owner in the SQL Editor), never logging
   evidence/prompts/output; UI: suggestions require user confirmation, "AI assistance
   unavailable — continue manually" on any failure. Wire server-owned mutation-success
   events in each mutation route through `lib/server/analytics.ts`, finalise Mixpanel
   delivery to the new demo project (region host from `.env.local`), verify decline/withdraw
   emit nothing, inspect payloads for content/PII, and align the two `flow_error_shown`
   mappings. Then run the complete manual and assisted journeys and an independent
   AI/privacy/analytics review before merging. Owner verifies ingestion in Live View.
3. **T5**: set AI variables on Vercel, verify the deployed `APP_ORIGIN`, run the acceptance
   checklist on https://food-proof.vercel.app at desktop and 360 px, keyboard-only, with
   fictional labels; verify the official destination before enabling it; record evidence
   per `docs/FOODPROOF_ACCEPTANCE_CHECKLIST.md`. No public launch, no tester contact, no
   code distribution without explicit authorization.
