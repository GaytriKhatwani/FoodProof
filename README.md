# FoodProof

An evidence and complaint-preparation app for India's celiac community.

**Status: T0 foundation + T1 data/persistence delivered and verified live against a dedicated demo Supabase project (42 tests, typecheck, lint all pass).** T2/T3 UI, T4 AI + live Mixpanel ingestion, and T5 deployment have not started. AI and deployment are configured later and are not verified live.

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
npm run test      # vitest run
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
2. **Apply migration 0003 (required).** Paste
   `supabase/migrations/0003_transactional_operations.sql` into the SQL Editor and
   run it. It adds the transactional functions the server calls for publication
   approval, withdrawal, reviewer removal, flag resolution, relinking and
   close/reopen, and it revokes RPC `EXECUTE` from `public`/`anon`/`authenticated`.
   It is idempotent, so re-running is safe. Until it is applied those operations
   fail loudly naming this file, and the integration suites that use them report
   BLOCKED instead of passing. Verify with `select fp_schema_version();` — it
   returns `3`.
3. Create the private storage buckets: `node --env-file=.env.local scripts/setup-storage.mjs`.
4. Generate invitation codes (shown once; distribute privately, never commit):
   `node --env-file=.env.local scripts/create-invitations.mjs --users 2`.
5. Seed the fictional pilot example (run `npm run dev` first; it drives the real
   API): `node --env-file=.env.local scripts/seed.mjs`.
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

## Release sequence

1. Public introduction plus restricted invited demo; mocked identity labels, real demo persistence and consented analytics.
2. Real email OTP, phone OTP, Google sign-in, production permissions and public-launch readiness.
3. Reminders and translations, separately scoped after public launch.

FoodProof prepares and organizes concerns. Official complaints are filed through government channels; brand messages are sent by the user. Community publication does not file a complaint or certify safety.
