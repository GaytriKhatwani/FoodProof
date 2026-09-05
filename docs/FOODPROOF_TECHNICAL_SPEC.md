# FoodProof — Phase-one technical contract

Status: Implementation defaults selected for the invited demo. Product decisions D16–D19 override earlier authentication requirements. Date: 5 September 2026.

## 1. Stack and scope

Use the supplied Git repository (visibility is owner-controlled) with a single Next.js App Router application, TypeScript, plain CSS with shared design tokens, Zod request validation, Supabase Postgres/Storage, and Mixpanel. Use Next.js Route Handlers as the only data API. No separate Express server, ORM, realtime subscriptions, cron jobs, or notification system. Pin stable compatible package versions at scaffold time and commit the lockfile. Vercel is the deployment default; another Next-compatible host can replace it without changing the product contract.

This is an engineering plan, not a claim that services are configured. The application is not built by these documents.

Public `/` is a static introduction with no pilot-data query. The `/pilot` entry page is accessible without a session. All nested `/pilot/*` application routes, evidence routes and protected data APIs require a server-validated demo session. The invitation exchange is the explicit API exception. Only demo/sample or redacted evidence is allowed. Production login and RBAC are phase two; do not expose the demo publicly by removing its entry guard.

## 2. Demo entry: minimum boundary without an identity provider

Test identities `user@foodproof` and `reviewer@foodproof` are UI labels. Do not send email to them or treat them as verified accounts. A public role picker must not grant reviewer powers.

Chosen default:

1. An operator script creates random, high-entropy invitation codes, storing only SHA-256 hashes in `demo_access`. Each tester gets a different code; the owner gets the reviewer code. No automated invitation sending.
2. The entry screen takes a code in a password input and posts it to `/api/demo/session`. Never put codes in query strings, analytics, logs, or source control.
3. On success, create a random session token, store its hash, and send the raw token only as an HttpOnly, Secure-in-deployment, SameSite=Lax cookie. Eight-hour session expiry; invitations expire after seven days by default. These are demo defaults, not verified personal identity.
4. Resolve actor and demo role from stored records, never the request body. Check invitation expiry/revocation on each request. Cap code attempts with a persistent limiter backed by the demo Supabase database (`demo_access_attempts`, §4): a keyed HMAC of the originating address keys a rolling-window row protected by a `UNIQUE(address_hmac, window_started_at)` constraint, and the counter is created or incremented atomically through an upsert, transaction or database function. Allow at most five failed invitation attempts per 15-minute window; beyond that return the `RATE_LIMITED` response (HTTP 429) with an appropriate `Retry-After`. Return the same generic response whether or not the submitted code exists, so the limiter never reveals code validity. A successful entry may clear the current counter. Never store the raw originating address; remove expired rows opportunistically (no scheduled job in this MVP). Phase one deploys to Vercel, so in-memory throttling alone is not sufficient on this multi-instance deployment; keep the limiter proportionate to the invited MVP.
5. Logout deletes the session and cookie. Reusing the same invite restores that actor's reports; clearing a browser does not create another identity. Different testers share the visible label but never an owner ID.

This basic pilot gate is essential to keep the public landing page separate from demo writes. It is not the production Supabase Auth/RBAC implementation. If this gate cannot be deployed and checked today, keep the demonstration local instead of deploying unguarded APIs.

Require same-origin checks for cookie-authenticated mutations; no GET route may mutate data. Set `Cache-Control: private, no-store` for pilot data and evidence responses. No service worker in phase one.

## 3. Supabase access boundary

Use a dedicated demo project. The browser never receives a privileged Supabase key. All database and Storage operations pass through `server-only` data-access modules after session, demo-role, ownership, and input checks. Revoke `anon` and `authenticated` grants on phase-one application tables, enable RLS, and create no direct-client allow policies for these tables. Storage buckets are private with no direct-client write policy.

The server secret/service role bypasses RLS: its safety depends on the server checks below. RLS deny-by-default prevents direct anonymous access but does not replace those checks. Never expose a generic SQL/table proxy or accept a caller-supplied owner ID.

Supabase documents grants plus RLS and cautions that service-role access bypasses RLS: [database access control](https://supabase.com/docs/guides/database/postgres/row-level-security). Private Storage uses access policies; keep privileged credentials server-side: [storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## 4. Schema contract

IDs are UUIDs. All times are UTC `timestamptz`, rendered in the viewer's locale. Use migrations under `supabase/migrations`; one integration owner controls schema changes. No automatic deletion of real material on seed/reset. All demo tables carry `dataset='demo'` or are in a demo-only project; no production migration carries sample reports forward.

**Canonical contract note:** This schema is completed by FOODPROOF_API_DETAILS.md, which is a required part of the T0 contract, not optional reading. It adds the `report_events` audit table (also listed below) and the `confirm-facts`, AI, `products/matches` and aggregate-read endpoints. T0 produces one merged set of shared Zod schemas and migrations from both documents before parallel work begins.

| Table | Essential columns and constraints |
|---|---|
| `demo_access` | id, token_hash UNIQUE, role ENUM(user,reviewer), label, expires_at, revoked_at, created_at |
| `demo_sessions` | id, access_id FK, token_hash UNIQUE, expires_at, analytics_consent BOOLEAN default false, analytics_actor_id nullable, analytics_session_id nullable, created_at |
| `operation_receipts` | id, actor_id FK, operation, idempotency_key, request_hash, response_json, created_at; UNIQUE(actor_id,operation,idempotency_key); private replay storage, no analytics payloads |
| `products` | id, brand, name, variant nullable, created_at; UNIQUE on the canonical identity key `(norm(brand), norm(name), coalesce(norm(variant),''))`; no claim of canonical catalogue completeness |
| `reports` | id, owner_access_id FK, product_id nullable FK, product_name, brand, variant nullable, concern_text, claim_text nullable, ingredients_text nullable, facts_confirmed_at nullable, observation_date nullable, batch_number nullable, preparation ENUM(draft,ready), lifecycle ENUM(open,closed_by_reporter), close_reason nullable, version INT, created_at, updated_at |
| `evidence` | id, report_id FK, object_path UNIQUE, kind ENUM(label,receipt,acknowledgement,response), roles TEXT[] subset(identity,claim,ingredients), mime_type, bytes, upload_state ENUM(pending,ready,failed), created_at; only ready objects satisfy requirements |
| `submissions` | id, report_id FK, channel ENUM(brand,government), recipient, submitted_at, reference nullable, acknowledgement_evidence_id nullable FK, created_at; always user-recorded |
| `complaint_drafts` | id, report_id FK, channel ENUM(brand,government), subject, body, method ENUM(template,assisted), version INT, updated_at; UNIQUE(report_id,channel), private only |
| `updates` | id, report_id FK, submission_id nullable FK, kind ENUM(follow_up,response,closed,reopened,label_change_claim), sender nullable, occurred_at, summary, evidence_id nullable FK, actor_access_id FK, created_at; response requires sender/date/summary; response and follow_up require submission_id matching report |
| `publication_revisions` | id, report_id FK, source_update_id nullable FK, revision INT, payload JSONB validated by allowlist, consented_at, requested_by FK, state ENUM(pending_review,changes_requested,rejected,approved,withdrawn,removed), reviewed_by nullable FK, reviewed_at nullable, reason nullable, version INT, created_at |
| `publications` | report_id PK/FK, approved_revision_id FK, visible BOOLEAN, approved_at, hidden_at nullable; pointer to the last approved report snapshot |
| `publication_assets` | id, revision_id FK, source_evidence_id FK, object_path UNIQUE; private sanitized copies used only through guarded media routes |
| `content_flags` | id, report_id FK, requested_by FK, reason, state ENUM(open,handled), reviewer_note nullable, created_at |
| `report_events` | id, report_id FK, actor_access_id FK, type, occurred_at, related_entity_id nullable, metadata JSONB allowlist; server-written internal audit (saves, review requests/decisions, withdrawal, relink); private reasons never projected. Defined with FOODPROOF_API_DETAILS.md |
| `demo_access_attempts` | id, address_hmac, window_started_at, attempt_count, expires_at; `UNIQUE(address_hmac, window_started_at)`; persistent invitation-attempt limiter (§2). `address_hmac` is short-lived pseudonymous security metadata — a keyed HMAC of the originating address, never the raw address — used only for abuse limiting, never for analytics or profiling; expired rows are deleted |

Indexes: reports(owner_access_id,updated_at), reports(product_id), submissions(report_id), updates(report_id,occurred_at), publication_revisions(state,created_at), the unique `products` canonical-key index above, the unique `demo_access_attempts(address_hmac, window_started_at)` index, session/token hashes. Partial unique index allows only one pending report revision per report and one pending response revision per update. UUID and foreign-key checks never substitute for ownership checks.

Avoid one global complaint status. Preparation, reporter closure, publication, and external history are independent. `ready` requires product/brand, concern, confirmed facts, and ready photos covering identity, claim, ingredients. This is an internal preparation threshold, not evidence of filing. Private drafts can be incomplete. `reports.preparation` is server-controlled: the server recomputes it from these criteria whenever confirmed facts or required evidence change, and persists the result transactionally with the triggering mutation. It is never client-settable and has no direct `preparation` transition endpoint.

Product matching uses one canonical normalization — trim, collapse internal whitespace, then case-fold, written `norm(x)` — applied to brand, name and variant, with a null variant normalized to an empty string. The same normalized key backs both exact-match suggestion and the `products` uniqueness constraint, so matching and uniqueness never disagree. Suggest exact normalized matches and let the user confirm the selection; otherwise create or reuse the exact identity transactionally. Preserve the user's entered display text. Do not fuzzy-merge automatically. A reviewer may relink a report with a logged reason. Each report remains independent. Show counts of published reports only, never imply unique people or independently verified incidents from that count.

## 5. Public projection and revision rules

`PublicReport` allowlist: report_id, product_id, product_name, brand, variant, concern_summary, confirmed_claim_text, confirmed_ingredients_text, observation_date, anonymous author label, approved asset IDs, publication date, and separately approved update summaries. Never include owner IDs, original object paths, reference numbers, recipient contacts, private close reasons, or private attachments.

Public external status is also reviewed content: snapshot per-channel values `no_submission_recorded`, `submission_reported`, `acknowledgement_attached`, `response_reported`. Private activity must not leak by recalculating public badges from private tables. New external status can be requested for review as a report revision. Display “As recorded in this published update” and its date; older approved snapshots may lag private history.

Publication request freezes an immutable payload and selected asset copies. AI edits and later private edits cannot change it. Reviewer sees this exact snapshot. Approval transaction updates revision state and the publication pointer together; optimistic `version` prevents approving stale data. Rejection/change request requires a reason. New approved revisions replace the pointer, not append duplicate feed cards. Responses have separately approved revisions attached to a visible parent publication. Withdrawing or removing a parent hides all its responses/assets. Re-publication requires a new reviewed request; do not resurrect removed content via an old approval action.

Moderation does not certify a regulatory violation. A documented-label-change badge requires a reviewed `label_change_claim` update with supporting evidence; it must not be a safety badge.

Original and published evidence stay in private buckets (`demo-originals`, `demo-reviewed`). Strip image metadata while re-encoding reviewed copies; reviewer must exclude images with personal details or request a redacted replacement. No in-app image-redaction editor in P0. Response PDFs may be stored privately (3 MB maximum); public summaries use text and separately reviewed image copies, not unreviewed PDFs.

Serve bytes through media routes that re-check session, ownership/reviewer permission or visible publication asset membership. Do not return long-lived URLs. This makes withdrawal effective for subsequent requests; files already downloaded cannot be recalled.

## 5a. Fictional seed data

The pilot's starting feed content is created by an operator seed script that uses the same application domain services and publication transactions as real reports — never raw inserts that bypass application invariants. Through those services the script creates:

- a dedicated seed demo owner in `demo_access` (its own `access_id`; role `user`);
- a clearly fictional report owned by that seed owner, with readable identity, claim and ingredient evidence;
- a publication request that freezes the allowlisted snapshot and selected sanitized asset copies;
- an owner-review approval that sets the publication pointer transactionally;
- the sanitized reviewed assets in the reviewed bucket, produced by the same re-encode/metadata-strip path as user content;
- a separately reviewed simulated response attached to the visible parent.

All seed rows carry `dataset='demo'` (or live only in the demo-only project), and every seed label and response is captioned fictional/simulated. The script honours the same idempotency and canonical-identity uniqueness rules as normal writes, so re-running it does not duplicate the product or the published report. Prepare the measurement document's second (unreported) fictional product as an unpublished report or as products/evidence the tester completes, per the pilot plan. This script is not a migration and never carries seed data into production identities.

## 6. API contracts

Success: `{ data, request_id }`. Error: `{ error: { code, message, fields? }, request_id }`. Codes: UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, CONFLICT, RATE_LIMITED, DEPENDENCY_UNAVAILABLE. Use 401/403/404/422/409/429/503 respectively. `RATE_LIMITED` responses include an appropriate `Retry-After` header. Do not expose raw provider errors or stack traces.

Mutations carry `Idempotency-Key` UUID; create operations and event IDs reuse the same logical operation on retry. Integration owner implements replay storage with a unique(actor_id,key,operation) and request-body hash; changed payload with reused key is 409. Update requests include `expected_version`; stale edits return 409 and preserve local input. Dates cannot be silently set to future submission/response dates.

| Route | Contract and authority |
|---|---|
| POST/DELETE `/api/demo/session` | Exchange invitation / logout; no role supplied by client |
| GET `/api/me` | Session actor label, demo role and current analytics-consent state; no invitation/session secrets |
| PUT `/api/me/analytics-consent` | Set allow/decline; mint random analytics IDs only on allow, clear on decline; analytics collection never required for use |
| GET/POST `/api/reports` | Own report list / private empty-or-partial draft; owner set server-side |
| GET/PATCH `/api/reports/:id` | Owner only; typed fields, expected_version; no lifecycle/publication mutation through generic PATCH |
| POST `/api/reports/:id/evidence` | Owner multipart upload; max 3 MB per file, JPEG/PNG/WebP, receipt/acknowledgement/response PDF private only; one file per request, content-type sniff and size validation; stream/validate size before buffering where supported |
| GET `/api/evidence/:id` | Owner or reviewer assigned reviewing that report; stream bytes |
| DELETE `/api/evidence/:id` | Owner removes from private draft; refuse if required by pending review, preserve any immutable reviewed copy; do not delete published assets |
| POST `/api/reports/:id/prepare` | Validate facts/readiness; return editable template draft; never send externally |
| PUT `/api/reports/:id/complaint-drafts/:channel` | Owner saves subject/body/method with expected_version; returns draft_id |
| POST `/api/reports/:id/submissions` | Owner records channel/recipient/date/reference/optional acknowledgement; check evidence belongs to report |
| POST `/api/reports/:id/updates` | Owner adds follow-up/response; matching submission/report relation required |
| POST `/api/reports/:id/close` or `/reopen` | Owner; close reason required, append audit update atomically |
| POST `/api/reports/:id/publication-requests` | Owner; validate evidence roles and consent, create snapshot; optional source_update_id belongs to report |
| POST `/api/reports/:id/withdraw` | Owner hides publication and invalidates pending approval requests atomically |
| GET `/api/feed?q=&cursor=` | Any valid pilot session; approved projections only; 20 results/page; newest publication first; search brand/name; no raw search strings in analytics |
| GET `/api/feed/:id` | Valid pilot session; only visible projection and approved responses |
| GET `/api/publication-assets/:id` | Valid pilot session plus currently visible parent; stream reviewed bytes only |
| POST `/api/feed/:id/flags` | Valid pilot session; create correction/removal flag, not public comment |
| GET `/api/review/queue` | Reviewer only; pending requests and open flags |
| GET `/api/review/:revisionId` | Reviewer only; requested snapshot and associated evidence |
| POST `/api/review/:revisionId/decision` | Reviewer only; action approve/request_changes/reject, expected_version, reason where required |
| POST `/api/review/reports/:id/remove` | Reviewer only, reason required; hides content and cancels pending approvals |
| POST `/api/review/reports/:id/relink` | Reviewer only; target product_id and reason; preserve report history |
| POST `/api/review/flags/:id/resolve` | Reviewer only; record decision/reason, optionally atomically remove associated publication |

Public homepage must not call `/api/feed`. API guards enforce this even if frontend routes are bypassed. Implement review-specific reads rather than granting the reviewer a generic API to list all private user accounts.

## 7. Access matrix (demo server enforcement)

Security boundary: production Supabase Auth, email OTP, phone OTP, Google sign-in and production RBAC remain phase two. Phase one still enforces invitation-resolved roles, per-request ownership checks and reviewer-only operations on the server. Visible test labels (`user@foodproof`, `reviewer@foodproof`) and client UI state confer no authority; every decision derives from stored session and role records, never the request body.

| Operation | No pilot session | Tester | Reviewer |
|---|---|---|---|
| Homepage | Yes | Yes | Yes |
| Approved pilot feed | No | Yes | Yes |
| Own drafts/files | No | Own only | Only if author; review-specific evidence access for queued cases |
| Other tester's private draft | No | No | No generic browse; only submitted review material |
| Publish/approve/remove | No | Request/withdraw own only | Review/approve/remove |
| Record submission or response | No | Own only | Cannot impersonate tester |
| Change own role | No | No | No |
| Direct Supabase client access | No | No | No |

Use report-specific checks on every request, not merely route layouts. Next.js distinguishes authentication, session management, and authorization and recommends centralized data-access checks: [Next.js guidance](https://nextjs.org/docs/app/guides/authentication).

## 8. Drafts and AI

Build deterministic complaint templates first. Fields: product/brand/variant, observation date if known, confirmed claim/ingredients, reporter concern, evidence checklist, requested clarification/correction. User must supply recipient and any personal contact details when sending externally; do not store them in public payloads.

AI adapter interface: `extractLabel(ownedEvidenceIds) -> { claimText?, ingredientsText?, productName?, brand?, unreadableFields: string[] }`; `draftComplaint(confirmedFacts, channel) -> { subject, body }`. Server validates ownership before calling provider, schema-validates outputs, caps input size/time/cost, and keeps credentials server-only. No arbitrary URL fetch or provider/tool instructions from uploaded text. Treat document contents as evidence, never instructions. User reviews all outputs. Use an environment-configured provider; implementation owner selects one after credentials are available and checks its official SDK docs then.

If AI is unavailable, show “AI assistance unavailable—continue manually.” Do not show fixture extraction as live AI. The product owner will provide an AI provider and budget before T4, so live extraction and drafting are required for full phase-one acceptance. The manual/template path remains mandatory and must work during provider failure. Do not hide a missing or failing provider behind a success badge. No provider or model is selected now; select one at T4 using then-current official provider documentation, structured-output capability, evidence-data terms and budget.

Official action default is Food Safety Connect. Candidate URL: `https://foscos.fssai.gov.in/consumergrievance/`. Automated retrieval failed during documentation; manually verify destination and flow before enabling the outbound action. Until verified, disable the link with a clear unavailable message; never invent an integration. Brand action: copy draft plus optional `mailto:` using user-confirmed recipient, with an explicit manual-attachment instruction. Testers must not actually send fictional complaints: demo external actions are optional and prominently labelled sample content.

## 9. Environment and project layout

Server-only: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER`, provider key, `MIXPANEL_TOKEN`, regional `MIXPANEL_API_HOST`, `APP_ORIGIN`, `RATE_LIMIT_HMAC_KEY` (keys the invitation-attempt limiter hash), `DEMO_MODE=true`. Runtime validates required config; `/` still renders if demo dependencies are unavailable. Never prefix secret keys with `NEXT_PUBLIC_`.

Use a server `POST /api/analytics` proxy with an event/property allowlist, consent checks, and rate limiting, rather than accepting arbitrary events. Authoritative mutation events should originate from the server after commit, not both client and server. Measurement doc governs identity/event IDs. No general HTTP proxy.

Layout: `app/` routes; `components/` shared UI; `lib/contracts/` Zod schemas/types; `lib/server/` session/data/storage/AI modules; `lib/analytics/`; `supabase/migrations/`; `scripts/` operator setup; `tests/` critical integration/e2e tests; `docs/` Markdown handoff (with README.md and AGENTS.md at the repo root) and `design/` reference assets. Fresh application repo: https://github.com/GaytriKhatwani/FoodProof.git, local /Users/gaytrikhatwani/ClaudeProjects/GovtCaseStudy/FoodProof/. It is separate from the read-only research mirror.

UI routes are canonical in FOODPROOF_SCREENS.md: `/pilot/feed`, `/pilot/concerns/:reportId`, `/pilot/reports/*`, and `/pilot/review/*`. The detail identifier is a report ID resolving the current approved revision, not a revision ID. Protect all these routes and corresponding APIs. Review route shorthand elsewhere refers to `/pilot/review`.

Analytics session IDs remain random per demo session and separate from persistent `demo_access.id`. Consented session context is stored on the server session for mutation-event emission; client view events use the same context. Exiting and re-entering resets analytics identity without resetting report ownership. Roles cannot change through analytics fields. Map evidence kind `receipt` to no evidence-upload event (optional receipt metric omitted); `label` to purpose `label`, acknowledgement upload to `acknowledgement`, response to `response`. IDs for response/follow-up events map to `updates.id`.

## 10. Exit checks and phase-two migration

Before invited demo: verify public homepage without credentials, denied direct/API access, distinct tester isolation, reviewer-only decisions, upload failures, snapshot publication/withdrawal, closure/reopen, real database persistence, and actual Mixpanel ingestion when consented. Demo labels stay visible. Data is fictitious or redacted.

Before public launch: replace demo sessions with Supabase Auth (email OTP, phone OTP, Google); map new verified owners deliberately rather than auto-claiming demo records; implement production RLS/storage policies and admin assignment; test allow/deny with two real accounts; remove demo invitations and seed data; enable public reads only for approved projections. Retention/deletion policy, abuse handling, notification of privacy practices, moderator readiness, and operator recovery must be finalized. Reminders and translations follow that release; not part of this contract.

## Clarifications for implementation

Read FOODPROOF_API_DETAILS.md with this contract; it is a required part of the canonical T0 contract, not optional. It resolves confirmation/AI/product endpoints, read aggregates, acknowledgement kinds and internal audit history (`report_events`). T0 merges both documents into the final shared Zod schemas and migrations before parallel work begins.
