# FoodProof — Implementation status

Last updated: 5 September 2026. Session: https://claude.ai/code/session_01UxFbZr5dzBJkEnP2QsfNRe

This is the current-state record for whoever picks up next. Authoritative product
scope lives in `docs/` (start at `docs/FOODPROOF_BUILD_HANDOFF.md`); this file
tracks build progress only.

## Repository state

- Branch `main`, remote `origin` = https://github.com/GaytriKhatwani/FoodProof.git
- **Pushed**: local `main` == `origin/main`. Working tree clean.
- Commits:
  - `d137f13` docs — corrected handoff baseline (refinements D25–D33, `docs/` layout, finalized rate-limiter contract)
  - `33815f2` feat(t0) — Next.js/TypeScript foundation, shared contracts, migration, tokens, homepage
  - `e0fd682` chore — refresh handoff manifest after T0

## Done

- **Documentation baseline**: review refinements folded in (decisions D25–D33); the
  17 specification docs moved under `docs/` (README.md + AGENTS.md stay at root);
  invitation-attempt limiter contract finalized (UNIQUE(address_hmac, window_started_at),
  atomic increment, 5 failed attempts / 15-min window, HTTP 429 + Retry-After, generic
  response regardless of code validity, opportunistic deletion; `address_hmac` = short-lived
  pseudonymous security metadata, never analytics/profiling).
- **T0 foundation** (scaffold + frozen contracts only — no feature behaviour):
  - Next.js 14.2.35 App Router + TypeScript 5.9.3, plain CSS tokens, Zod 3.25.76; pinned deps + `package-lock.json`.
  - `lib/contracts/` — frozen shared Zod schemas/types: envelope + error codes, enums, strict request bodies, owner read models, public projection allowlist, analytics envelope + full event dictionary.
  - `lib/server/` — lazy env validation, typed Supabase service client, and session/data/storage/ai/analytics/rate-limit **interfaces with explicit not-implemented T0 stubs**; keyed-HMAC address hashing utility.
  - `supabase/migrations/0001_init.sql` — full schema (enums, `norm()`, atomic `record_access_attempt()`, partial-unique single-pending-revision indexes, canonical products key, RLS deny-by-default). **Written, not applied.**
  - Clear Signal design tokens; static public homepage `/`; honest `/pilot` placeholder; demo-only `/api/health` readiness fixture (config booleans only).
  - `tests/` — ownership fixtures + contract tests; `scripts/README.md` placeholder for T1 operator scripts.

## Checks (last run 5 September 2026)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS |
| Tests | `npm run test` | PASS (8/8) |
| Build | `npm run build` | PASS (`/`,`/pilot` static; `/api/health` dynamic) |
| Dev smoke | `npm run dev` | `/`→200, `/pilot`→200, `/api/health` (DEMO_MODE=true)→200 booleans-only |
| Docs | local Markdown links | 23/23 resolve; manifest hashes match |

## Not started (do not begin without assignment)

- **T1** data/persistence, **T2** reporter UI, **T3** community/moderation UI, then **T4** integrate+AI+analytics, **T5** deployed pilot check.
- No T1–T3 code exists. `lib/server/*` are stubs. Migration is unapplied. No live Supabase/Mixpanel/AI.

## Open configuration (blocks the integrated pilot, not T0)

- Integration owner assignment.
- Dedicated **demo** Supabase + Mixpanel projects, credentials, region.
- AI provider/model + data terms + budget — owner provides **before T4**; no provider/model is named in any document (deliberate).
- Deployed `APP_ORIGIN` on Vercel; official FSSAI destination browser-verification; contact/moderator route; 30-day retention confirmation.

## Exact next action

Assign one ticket per agent on its own branch, non-overlapping paths, using the frozen
`lib/contracts/` and `lib/server/` interfaces (raise contract changes to the integration
owner — do not edit shared schemas/migration/lockfile/global nav). Kickoff prompt per agent:

> Read `AGENTS.md`, `README.md`, `docs/FOODPROOF_BUILD_HANDOFF.md` and its linked contracts
> (`docs/FOODPROOF_TECHNICAL_SPEC.md` + `docs/FOODPROOF_API_DETAILS.md` are the canonical frozen
> T0 contract; plus `docs/FOODPROOF_SCREENS.md`, `docs/FOODPROOF_WORKFLOWS.md`, `docs/DESIGN.md`).
> Implement **ticket T[n] only**, on branch `t[n]-<area>`, against the frozen shared contracts.
> Honour the demo boundary, server-enforced ownership/roles and the exact API/state contracts;
> keep secrets server-side. Finish with a working slice, the checks you ran, and unresolved
> dependencies. Do not push, deploy, or contact testers without authorization.
>
> - T1 (data): own `lib/server/*`, `app/api/**`, operator scripts, server integration tests — replace stubs with real demo-Supabase impls, apply the migration, implement the limiter and the D25 seed script; verify two-tester isolation, reviewer-only mutations, expiry/revocation, withdrawal.
> - T2 (reporter UI): screens §5–9 against the shared client with labelled fixtures until T1 lands.
> - T3 (community UI): homepage build-out, pilot entry, feed, detail, reviewer views (screens §1–4, §10).

Recommended order: T1 first (or T1 ∥ T2/T3 against agreed fixtures), since T2/T3 integrate real T1 APIs before completion.
