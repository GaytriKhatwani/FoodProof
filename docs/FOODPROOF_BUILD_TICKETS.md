# FoodProof — Agent build tickets

Status: Prepared for team review; repository supplied. Assign after contract acknowledgement. Phase one is an invited demo, not production authentication. Read the handoff index first. Technical defaults are chosen, not new user research findings.

## Shared execution contract

Integration owner alone changes package manifests, lockfiles, migrations, shared Zod/types, environment schema, and route/API contracts. Work on separate Git branches/worktrees. Do not let multiple agents edit the same files. A UI agent uses service adapters against the frozen API, never direct Supabase queries. Any contract gap goes to the integration owner for one recorded decision and broadcast update.

Commit after each working slice. Report changed files, checks run, remaining dependency, and exact handoff to integration owner. No agent may silently drop scope, publish a repository, send complaints, deploy unrestricted data, or add reminders/translations.

## T0 — Scaffold and freeze contracts (integration owner; first)

Use the supplied repository and retain the handoff Markdown files at its root. Initialize Git only if absent; never reset existing work or nest a second application repository. Scaffold Next.js/TypeScript with one lockfile and basic lint/build checks. Add `.env.example` with placeholders, `.gitignore`, shared tokens, API request/response schemas, migrations from technical spec, and a typed service client.

Create invitation/session helper interfaces, public projection types, revision enums, analytics envelope, and ownership test fixtures before parallel work begins. Choose compatible package versions and record them. No dummy key values presented as credentials.

Acceptance: homepage skeleton runs; type check/build passes; fixture routes are explicitly local/demo-only; all agents agree on shared contract paths. Freeze before T1–T3.

## T1 — Demo boundary and persistence (data agent)

Own `lib/server/`, data API handlers, invitation operator scripts, and focused server integration tests. Request migration changes from integration owner.

Implement invitation sessions, revocation/expiry, origin checks, the persistent Supabase-backed invitation-attempt limiter (keyed HMAC of the originating address, rolling window and expiry), ownership checks, private storage, report CRUD, server-derived `preparation`, immutable review snapshots, publication transactions, withdrawal, and external-history persistence. Add complaint-draft saving and optimistic concurrency. Implement guarded media responses and the fictional seed-data script (technical spec §5a) that drives the published example and its simulated response through the same publication services. Use server-only Supabase access, deny direct client grants.

Acceptance: two tester invites cannot access each other's drafts by guessed IDs; tester cannot approve by direct API; expired/revoked invite fails; public requests reveal no pilot data; valid saves survive reload; withdrawn copies stop serving; repeated create/approve requests do not duplicate content. Real project unavailable means integration pending, not silent local fallback.

## T2 — Reporter flow (reporting UI agent; parallel with T1/T3)

Own report-editor, action, My reports, timeline, and response components/routes. Use shared client; do not change schema or global navigation. Build screen contracts 5–9 with seeded API fixtures during development, visibly marked until real adapter is integrated.

Implement evidence roles, incomplete private saving, confirmed facts, publication preview/consent, deterministic editable templates, explicit external handoff, separate submission histories, private responses, manual follow-ups, closure/reopen. No reminder controls. Emit client view/copy/handoff events through the shared analytics adapter; server owns save-success events.

Acceptance: full reporter journey works against fixtures, preserves failed input, and never confuses save/publish/send. Integrate real T1 API before ticket is complete. Sample complaint copy must tell testers not to send fictional reports to real recipients.

## T3 — Public introduction, feed, and moderation (community UI agent)

Own public homepage, entry, feed, concern details, reviewer views, and shared shell components. Respect T0 tokens. Build screen contracts 1–4 and 10. Public home makes no pilot API requests. Invitation determines role; no public reviewer switch.

Implement search, empty/error states, product-linked independent reporting entry, review-specific evidence view, required rejection/change reasons, stale review recovery, corrections and withdrawal handling. Explain approved-for-publication versus verified safety.

Acceptance: anonymous visitor sees intro only; invited tester sees approved feed; owner reviewer approves the exact snapshot; edits do not silently modify publications; removed parent hides approved responses too. Cross-check T2 links before merge.

## T4 — Integrate, add AI, and verify measurement (integration owner after merges)

Merge T1–T3 incrementally, run critical tests, resolve API mismatches centrally. The owner provides an AI provider and budget before T4 (D33); select the provider and model then using then-current official documentation, structured-output capability, evidence-data terms and budget — no provider or model is named in these documents. Configure the AI adapter only from confirmed facts and owned evidence. Validate structured extraction, user correction, editable draft, timeout/manual fallback, and no invented safety/legal conclusion. Live extraction and drafting are required for full phase-one acceptance, while the manual/template path stays mandatory and must work during provider failure. If the provider is genuinely unavailable, record AI as incomplete rather than simulating live success.

Wire consented event collection and actual Mixpanel ingestion from the measurement doc. Verify event retry IDs, no duplicate client/server saves, role separation, no PII, and no collection on decline. Verify external destination manually before enabling official handoff. Add README with local run, config, invitation generation, seed instructions, and limitations.

Acceptance: integrated checks in technical and pilot docs pass; all outstanding services are explicitly named. Do not call local fixtures a working Supabase/Mixpanel integration.

## T5 — Deployed invited-demo check (integration owner + product owner)

Product owner configures Supabase, Mixpanel, hosting, and AI if used; OTP/SMS/Google setup is not today's critical path. Deploy only to a user-approved destination with guarded pilot routes. Issue invite codes privately by the owner. No tool messages to testers without explicit authorization.

On deployed URL, repeat homepage separation, user/reviewer permissions, save/reopen, upload, share/moderate/feed, response privacy, withdrawal, close/reopen, and consented events. Test at 360 px and keyboard-only. Use fictional sample labels, no live accusations. Run three to five observed sessions; fix blocking comprehension/usability issues.

Acceptance: give URL, tested capabilities, exact limitations, and service readiness. Public launch remains phase two.

## Dependency order

T0 → T1/T2/T3 in parallel → T4 → T5. Parallel UI can use agreed fixtures, but integration cannot be skipped. A second agent should review access and status checks while the integration owner completes deployment configuration, if a slot is available.

## Short assignment format

Assign one ticket at a time: “Read FOODPROOF_BUILD_HANDOFF.md and its linked contracts. Implement ticket T[n] only on your assigned branch and paths. Honour the demo boundary, exact API/state contracts, and acceptance criteria. Raise contract changes to the integration owner. Finish with changed files, checks, and unresolved dependencies.”

## Phase two before unrestricted launch

Real Supabase email OTP, phone OTP, Google sign-in and account linking decisions; production RBAC/RLS/storage tests; remove demo code/data; public approved-projection access; owner moderation operations and correction/deletion policy; production analytics configuration. Only then add reminders/translations as separately scoped tickets.
