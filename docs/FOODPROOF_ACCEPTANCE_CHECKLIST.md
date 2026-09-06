# FoodProof — Build acceptance checklist

All application checks below are **not run** at handoff. The prior preview test covered local UI only. Record environment/build, tester, date and evidence for each result. Passing a mock is not passing a live integration.

| ID / requirements | Required observation |
|---|---|
| A01 / R01–02 | Public homepage works without a session; feed/detail/media APIs deny unauthenticated access; entry page remains accessible |
| A02 / R02,12–13 | Two tester invitations cannot cross-read/edit files or reports by guessed IDs; tester cannot approve or self-assign reviewer; expiry/revocation works |
| A03 / R03,13 | Incomplete save and upload survive reload in Supabase; failed save preserves inputs; retry does not duplicate records |
| A04 / R04 | One image can cover three roles; missing/not-ready evidence blocks publication but not private saving; changed facts require reconfirmation |
| A05 / R05 | Real extraction on legible/unreadable samples produces editable suggestions; user correction works; timeout/manual fallback works; no invented legal/safety conclusion |
| A06 / R06 | Template/draft save and successful copy are distinct; opening destination creates no submission; manual attachments explained |
| A07 / R07 | Unchecked consent blocks request; review freezes exact selected content; changes requested/rejected need reasons; new private edits do not alter feed |
| A08 / R07,12 | Approval, stale-review conflict, withdrawal, removal and resubmission work atomically; hidden parent's responses/assets stop serving |
| A09 / R08–09 | Search and empty states work; no result implies no safety guarantee; linked report copies identity only and keeps own evidence/history |
| A10 / R10 | Brand and government histories independent; response requires sender/date/summary and matching submission; remains private until separate approval |
| A11 / R11 | Close requires reason, does not hide feed or imply safety; reopen persists and history remains |
| A12 / R12 | Correction flag is private, owner can resolve/remove with reason, no promise of a response time |
| A13 / R13 | Direct anon/authenticated database/storage access denied; privileged key absent from client; uploads enforce type/size; reviewed image metadata stripped |
| A14 / R14 | Real consented QA events appear in demo Mixpanel with correct schema, no content/PII; declined/withdrawn consent emits no optional events |
| A15 / R14 | Reloads/retries do not double-count logical saves; reporter/reviewer separated; publication joined by report ID, not same-person funnel |
| A16 / R15 | At 360px and desktop, core flow fits; keyboard labels/focus/errors usable; reduced motion works; unsupported files and lost session recover clearly |
| A17 / all | Repeat critical flow on guarded deployed URL using actual services; no fixture or simulated success is presented as live |

## Release evidence record

For every check record: ID, pass/fail/blocked/not run, build identifier, environment, steps/observation, evidence location and unresolved issue. Keep keys, invitation codes and personal data out of logs/screenshots committed to Git.

Build checks: typecheck, lint and production build. Focus automated tests on permissions, snapshot/withdrawal semantics, concurrency, persistence and event contracts. Use browser tests for the complete reporter/reviewer journey. Do not substitute dozens of implementation-mirroring tests for these risks.

Any exposure, data loss, false filing status or misrepresented integration blocks the invited demo. The owner provides an AI provider and budget before T4 (D33), so A05's live extraction/drafting is required for full phase-one acceptance; if the provider is genuinely unavailable, missing AI is recorded separately as incomplete intended scope and the owner must approve a narrower release. Public launch always requires phase-two authentication and policy checks.

Pilot usability tasks, cohort and interpretation thresholds are in FOODPROOF_MEASUREMENT_AND_PILOT.md. Keep a separate finding log with observed behaviour, severity, proposed correction and retest result.

## Evidence record — T4 (6 September 2026, local build against the live demo services)

Environment: `main` after the T4 merge (commit ids in `IMPLEMENTATION_STATUS.md`), dedicated demo Supabase project with migrations 0001–0004, the real AI provider, the demo Mixpanel project, `ANALYTICS_AUDIENCE=qa`. Evidence = the named automated suites, run by the integration owner; see the "Checks" table in `IMPLEMENTATION_STATUS.md` for counts.

| ID | Result | Evidence |
|---|---|---|
| A03 | pass | `tests/integration/reports.test.ts` (retry dedup, receipt release) unchanged; `tests/integration/analytics.test.ts` proves a same-key retry re-sends one `$insert_id` |
| A05 | pass (local) | `tests/integration/ai.test.ts`: live extraction on a readable synthetic label, on the fictional photograph and on a blank image (unreadable fields reported honestly); prompt-injection label transcribed without obeying it; live draft from confirmed facts with placeholders and no safety/filing/statutory wording; `tests/unit/ai.test.ts`: timeout / 429 / 5xx / connection / refusal / truncation / malformed / off-schema → "AI assistance is unavailable." with one released reservation; manual confirmation and template drafting with the provider disabled; `tests/e2e/reporter-ai.spec.ts`: the editor and actions screens, including the exact “AI assistance unavailable—continue manually.” state with typed values preserved. Not yet repeated on the deployed URL (A17/T5) |
| A08 | pass | `tests/integration/publication.test.ts` incl. the three T4 regression tests (atomic request under storage failure; foreign evidence refused in the transaction; one effective approved response revision, superseded image not served) |
| A13 | pass | unchanged direct-client denial suite; migration 0004 functions revoked from `public`/`anon`/`authenticated`; `ai_spend_ledger` RLS-enabled with anon/authenticated revoked |
| A14 | pass (ingestion) / owner (read-back) | `tests/integration/analytics.test.ts`: real `feed_viewed` accepted (`{"status":1}`), duplicate accepted, stale event rejected, declined and withdrawn sessions emit nothing; `tests/unit/analytics-pii.test.ts` whitelists the payload keys; Live View inspection of a `scripts/analytics-journey.mjs` run is the owner's step (no service account) |
| A15 | pass | stable `$insert_id` from the Idempotency-Key + persisted `occurred_at` (`tests/unit/analytics-events.test.ts`, `tests/integration/analytics.test.ts`); reporter/reviewer separated by `actor_role`; `report_published` joined by `report_id` |
| A17 | not run | T5 |
