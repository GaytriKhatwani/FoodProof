# FoodProof

An evidence and complaint-preparation app for India's celiac community.

**Status: T0 foundation scaffolded and verified (typecheck, lint, tests, production build all pass). Feature slices T1–T3 have not started.** Supabase, Mixpanel, AI and deployment are configured later and are not verified live.

Start with [the handoff](docs/FOODPROOF_BUILD_HANDOFF.md), then [the PRD](docs/FOODPROOF_PRD.md). Review [the audit and open items](docs/FOODPROOF_REVIEW_REPORT.md) before assigning [build tickets](docs/FOODPROOF_BUILD_TICKETS.md).

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

The scaffold is the T0 foundation only: shared contracts (`lib/contracts/`),
typed service interfaces with explicit not-implemented stubs (`lib/server/`),
initial migration (`supabase/migrations/0001_init.sql`), Clear Signal tokens and
a static public homepage. Feature behaviour arrives in T1–T3.

## Release sequence

1. Public introduction plus restricted invited demo; mocked identity labels, real demo persistence and consented analytics.
2. Real email OTP, phone OTP, Google sign-in, production permissions and public-launch readiness.
3. Reminders and translations, separately scoped after public launch.

FoodProof prepares and organizes concerns. Official complaints are filed through government channels; brand messages are sent by the user. Community publication does not file a complaint or certify safety.
