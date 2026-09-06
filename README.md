# FoodProof

An evidence and complaint-preparation app for India's celiac community.

**Status: phase one is complete — T0–T5 are merged to `main`, verified live against the dedicated demo Supabase project, the real AI provider and the demo Mixpanel project (typecheck, lint, build, 239 unit + integration tests, 128 browser specs at desktop and 360 px), and the deployed acceptance run passed 16/16 on https://food-proof.vercel.app — see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).** T4 added live AI assistance (Anthropic Claude API, model `claude-sonnet-5`, low effort, hard spend cap USD 2.00 enforced by a durable ledger; label photographs are metadata-stripped before they leave), live consent-controlled Mixpanel ingestion with server-owned success events, and two integrity fixes (atomic publication requests; one effective approved revision per response). T5 verified the guarded deployment (AI enabled, verified FSSAI official-portal handoff enabled), closed the feed-thumbnail and upload-progress gaps and hardened the UI for accessibility. Real sign-in (phase two, C.1) is the next ticket set. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the exact state, rulings, owner decisions, known gaps and the continuation prompt.

Start with [the handoff](docs/FOODPROOF_BUILD_HANDOFF.md), then [the PRD](docs/FOODPROOF_PRD.md). Review [the audit and open items](docs/FOODPROOF_REVIEW_REPORT.md) before assigning [build tickets](docs/FOODPROOF_BUILD_TICKETS.md). Current build progress and the exact next step are in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

- Repository: https://github.com/GaytriKhatwani/FoodProof.git
- Local folder: `/Users/gaytrikhatwani/ClaudeProjects/GovtCaseStudy/FoodProof/`
- Approved design: [Clear Signal preview](design/foodproof-clear-signal.html), [concept image](design/reference/approved-concept.png), [design rules](docs/DESIGN.md).
- Preview is an interaction reference with fictional data. It saves nothing to a backend and sends nothing.

## Development

Requirements: Node.js >= 20 (developed on 24). Commands below are verified in T0:

```bash
npm install       # install pinned dependencies (package-lock.json committed)
npm run dev       # start the dev server (http://localhost:3000)
npm run build     # production build
npm run start     # serve the production build
npm run typecheck # tsc --noEmit
npm run lint      # next lint
npm run test      # vitest run (unit/contract + live integration suites)
npm run test:e2e  # playwright test (browser specs; starts next dev)
```

Copy `.env.example` to `.env.local` and fill values from your dedicated DEMO
Supabase/Mixpanel projects before running features that need them. The public
homepage (`/`) renders with no configuration; server env is validated lazily.
No secret is ever prefixed `NEXT_PUBLIC_`. `/api/health` is a demo-only readiness
fixture (returns config-group booleans, never values) available when `DEMO_MODE=true`.

### Demo project setup (T1)

Against a **dedicated demo** Supabase project (never production):

1. Apply the schema: paste `supabase/migrations/0001_init.sql` into the Supabase
   SQL Editor and run it. On a project where `0001` was applied before the
   `service_role` grants were folded in, also run `0002_service_role_grants.sql`.
2. **Apply migrations 0003 and 0004 (required), in order.** Paste
   `supabase/migrations/0003_transactional_operations.sql` into the SQL Editor and
   run it, then `supabase/migrations/0004_publication_atomicity_and_ai_spend.sql`.
   0003 adds the transactional functions for publication approval, withdrawal,
   reviewer removal, flag resolution, relinking and close/reopen, and revokes RPC
   `EXECUTE` from `public`/`anon`/`authenticated`. 0004 makes the publication
   request itself one transaction, adds the AI spend ledger (`ai_spend_ledger` and
   the `fp_*_ai_spend` functions; costs and token counts only, never content) and
   returns the ids server-owned analytics events need. Both are idempotent, so
   re-running is safe. Until they are applied those operations fail loudly naming
   the file, and the integration suites that use them report BLOCKED instead of
   passing. Verify with `select fp_schema_version();` — it returns `4`.
3. Create the private storage buckets: `node --env-file=.env.local scripts/setup-storage.mjs`.
4. Generate invitation codes (shown once; distribute privately, never commit):
   `node --env-file=.env.local scripts/create-invitations.mjs --users 2`.
5. Seed the fictional pilot example (run `npm run dev` first; it drives the real
   API): `node --env-file=.env.local scripts/seed.mjs`. To replace the seeded
   example, e.g. after this image fix, add `--reset`: it removes only the rows
   and Storage objects owned by the seed's own two invitations before
   re-seeding, and never touches any other invitation.
6. Integration tests self-skip without live credentials; with `.env.local` present
   they run against the demo project and clean up after themselves. Set the
   test-only `SUPABASE_PUBLISHABLE_KEY` (the project's `sb_publishable_...` key,
   never read by the application) to run the direct-client denial suite; without
   it that suite is skipped, not passed.
   Teardown (dry-run by default): `node --env-file=.env.local scripts/teardown.mjs`.

T1 replaces the `lib/server/` stubs with real demo-Supabase implementations and
adds the data API under `app/api/**` (session/limiter, reports, evidence + guarded
media, drafts, external history, publication/moderation, feed, flags, analytics
proxy). T2/T3 build the UI against these frozen contracts; T4 wires live AI and
Mixpanel ingestion.

### AI assistance and analytics (T4)

- **AI provider:** Anthropic Claude API, model `claude-sonnet-5` (override with
  `AI_MODEL`), `effort: low`, structured JSON outputs, SDK `@anthropic-ai/sdk` 0.124.0.
  Set `AI_PROVIDER=anthropic` and `AI_PROVIDER_API_KEY` (server-only) to enable
  `POST /api/reports/:id/ai/extract` and `/ai/draft`; leave them blank and the app runs
  with the manual / deterministic-template path only, which is always available.
- **Limits enforced server-side** (`lib/server/ai/limits.ts`): ≤ 3 label photos per
  call, ≤ 3 MB each (jpeg/png/webp), 30 s timeout, 1024 / 1500 output tokens,
  USD 0.06 per call, USD 0.50 per invitation, USD 2.00 for the whole pilot, 6 calls
  per minute per invitation. Spend is reserved in `ai_spend_ledger` before every
  provider call and settled on real usage (`select fp_ai_spend_totals();` shows the
  running total). AI output is advisory: extraction returns suggestions the reporter
  applies and confirms; drafting returns an editable suggestion saved separately. Any
  failure shows “AI assistance unavailable—continue manually.”
- **Provider data handling** (official documentation, 6 September 2026): API prompts
  and outputs are not retained by default and are not used for model training under
  the provider's Commercial Terms; images are not stored beyond the request. Evidence
  photographs are sent only after ownership and type checks, never stored by the
  provider integration, and never logged.
- **Analytics:** the server posts only allowlisted events to the dedicated demo
  Mixpanel project (`MIXPANEL_TOKEN`, regional `MIXPANEL_API_HOST`) after explicit
  consent; withdrawal clears the identifiers. Mutation-success events are emitted by
  the server after commit with stable `$insert_id`s. Set `ANALYTICS_AUDIENCE=qa`
  locally so QA traffic is separable from invited testers. Verify a journey with
  `node --env-file=.env.local scripts/analytics-journey.mjs` (dev server running) and
  compare in Mixpanel Live View.

## Release sequence

1. Public introduction plus restricted invited demo; mocked identity labels, real demo persistence and consented analytics.
2. Real email OTP, phone OTP, Google sign-in, production permissions and public-launch readiness.
3. Reminders and translations, separately scoped after public launch.

FoodProof prepares and organizes concerns. Official complaints are filed through government channels; brand messages are sent by the user. Community publication does not file a complaint or certify safety.
