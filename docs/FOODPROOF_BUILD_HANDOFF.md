# FoodProof — Start here

Status (6 September 2026, end of day): **Phase one is COMPLETE — T0–T5.** T0–T4, the post-T4 pilot-integrity hardening pass (migration `0005`), the T5 deployed check (A.1–A.5; deployed acceptance A01–A16 passed 16/16 on https://food-proof.vercel.app with real services — `docs/evidence/A17-deployed-acceptance-2026-09-06.md`), the B-item closures (feed identity thumbnails, upload progress), an AI image-metadata-strip privacy fix and a UI accessibility/responsive hardening pass (`docs/FOODPROOF_UI_AUDIT.md`) are all merged to `origin/main` and live-verified — head `d5149ba` or later, `fp_schema_version()` = 5, working tree clean, demo project at its seed baseline. `IMPLEMENTATION_STATUS.md` at the repository root is the canonical record: final checks (vitest 239/239, Playwright 128/128), the owner decisions of 6 September 2026 (do not re-ask them) and the continuation prompt. Observed pilot sessions (A.6) were dropped by the owner: no external testers on the invitation-code flow. **Next: Phase two C.1 — real sign-in** (owner chooses providers first). The only production dependency advisory (Next.js, at latest 14.2.x) still needs a compatibility-reviewed **major upgrade** before public launch — deferred by the owner; do not blind-bump.

## Build target

A public introduction and invitation-gated demonstration for the celiac community in India. Private evidence → confirmed facts → editable complaint → manual external-action history. Optional sharing → owner moderation → community feed. English only, fictional/redacted evidence, test identity labels, Supabase persistence, actual consented Mixpanel demo events. AI extraction/drafting follows the working manual loop; provider configuration remains open.

Real email OTP, phone OTP, Google sign-in and production role enforcement precede phase-two public launch. Reminders and translations follow. Do not implement these ahead of the core loop.

## Read order

| File | Authority / use |
|---|---|
| [PRD](FOODPROOF_PRD.md) | Current P0 scope and requirements index |
| [Product brief](FOODPROOF_PRODUCT_BRIEF.md) | Vision, user evidence, hypotheses and guardrails |
| [Decision log](FOODPROOF_DECISIONS.md) | Historical decisions with explicit supersession; D23–D24 record approval/repo |
| [Workflows](FOODPROOF_WORKFLOWS.md) | Journeys, states and exceptions |
| [Screens](FOODPROOF_SCREENS.md) | Functional UI content, routes, error states |
| [Design](DESIGN.md) | Approved visual system |
| [Prototype mapping](FOODPROOF_PROTOTYPE_TO_BUILD.md) | What to retain visually and what needs real implementation |
| [Technical specification](FOODPROOF_TECHNICAL_SPEC.md) | Stack, schema, access and revision contracts |
| [API supplement](FOODPROOF_API_DETAILS.md) | Cross-document gaps resolved for T0 schema implementation |
| [Measurement and pilot](FOODPROOF_MEASUREMENT_AND_PILOT.md) | Exact events, consent, observed tasks, interpretation limits |
| [Acceptance checklist](FOODPROOF_ACCEPTANCE_CHECKLIST.md) | Build verification matrix and evidence format |
| [Setup and operations](FOODPROOF_SETUP_AND_OPERATIONS.md) | Owner/engineer setup, moderator and demo lifecycle |
| [Tickets](FOODPROOF_BUILD_TICKETS.md) | Scope, dependencies and file ownership |
| [Agent prompts](FOODPROOF_AGENT_PROMPTS.md) | Small staged assignments |
| [Review report](FOODPROOF_REVIEW_REPORT.md) | Corrections, unresolved inputs and readiness assessment |

Root AGENTS.md governs agent execution. Latest explicit decisions govern scope; PRD consolidates them. Technical specification plus API supplement govern data/contracts; screens govern functional content; DESIGN.md governs visual styling. The prototype never overrides access, persistence or failure-state requirements. Escalate material contradictions to the integration owner and record one resolution before implementing that portion.

## Repository and portable design

Remote: https://github.com/GaytriKhatwani/FoodProof.git. Local: `/Users/gaytrikhatwani/ClaudeProjects/GovtCaseStudy/FoodProof/`.

Open `../design/foodproof-clear-signal.html` for the standalone preview. Editable fragment, approved concept and generated image with provenance travel with the repository. No user-specific Codex paths or unavailable skills are required to build. Do not ship rejected concept alternatives.

## Team sequence

Team reviews this package, then assigns one integration owner. T0 establishes scaffold, migrations and shared schemas. T1 services, T2 reporter UI and T3 community UI may then proceed on separate branches with nonoverlapping ownership. Merge working slices incrementally. T4 verifies AI/analytics and T5 checks the guarded deployed pilot. Do not launch publicly from a successful local preview.

Configuration can proceed alongside coding. Service keys belong in environment secrets. The integration owner must keep an honest readiness record: configured, tested, blocked, or not started. Final handoff must include actual check results and limitations, not only screenshots.
