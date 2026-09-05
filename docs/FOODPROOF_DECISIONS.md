# FoodProof — Decision log

This file records explicit product decisions. Read alongside FOODPROOF_PRODUCT_BRIEF.md. Recommendations awaiting a reply are not approved requirements.

## Approved — 5 September 2026

Historical decisions are retained for traceability. D02 is resolved by D17; D06 applies at phase-two launch; D10 is superseded by D18; D15 is resolved by D24; D19–D21 are superseded by D22–D23. Statements below such as “not yet named” or “not approved yet” describe their historical moment, not current blockers. D17 resolves the reviewer assignment in D02. D18 supersedes D10: real authentication is phase two. Latest explicit decisions govern.

### D01. External complaint sending

FoodProof prepares editable drafts. Users send brand messages through their own email app and submit official complaints through external official channels. Users then record submission details in FoodProof.

Opening an email app or portal does not establish that a message was sent or a complaint filed. No automatic sending or status synchronization is included in the MVP.

### D02. One designated publication reviewer

One designated reviewer uses a simple admin screen to review reports before public publication during the pilot. The reviewer also handles correction and removal requests.

The person filling this role has not yet been named. Do not assume the product owner has volunteered. Role assignment is required before public pilot operation, not before workflow design.

### D03. Anonymous public reporting

Published reports identify their authors as anonymous contributors. Account identity stays private and is never included in public report payloads or assets.

Public anonymity does not mean anonymity to the brand or government recipient: external submissions use the identity and details the user supplies through those channels. Explain this distinction at handoff.

### D04. Evidence minimum for publication

Publication requires photographs showing product identity, the gluten-free claim, and the ingredient list, plus a short explanation of the concern. One photograph may satisfy several requirements. Receipts and batch numbers are optional. Incomplete reports may be saved privately as drafts.

This publication rule scopes the initial public reporting flow to concerns with a photographed gluten-free claim. Do not silently broaden eligibility to other complaint types.

### D05. Publication is independent of external submission

A reviewed, consented concern may be published before the reporter contacts a brand or official channel. Show “No external submission recorded” when applicable. Publication must not imply external filing or delivery.

### D06. Public browsing without sign-in

Visitors may browse and search the published feed and read public concern details without an account. Sign-in is required to save a report, contribute evidence, or manage complaints. Public visitors only receive approved public content.

### D07. Manually recorded responses, private by default

Users manually record brand or government responses with sender, date, and summary. A screenshot or document is optional. Updates remain private unless the user requests publication and the moderator reviews them. A recorded response is not automatically verified or a resolution.

### D08. No reminders in the MVP

Defer all follow-up reminders, including in-app reminders, reminder dates, email, and push notifications. Users can still manually record follow-ups and responses in their report timeline. Do not implement reminder settings, scheduling infrastructure, or reminder UI for P0.

### D09. Reporter-controlled closure and reopening

Users may mark their complaint “Closed by reporter,” provide a reason, and reopen it. Closure is separate from “Response recorded” and does not imply safety, a fixed issue, or an externally confirmed resolution. Display a label change as documented only after supporting evidence is reviewed. Closure does not itself change publication visibility.

### D10. Three sign-in methods in phase one

Support email OTP, phone OTP, and Google sign-in through Supabase Auth. Do not silently substitute a single method to meet the deadline. Real provider configuration and end-to-end validation are launch dependencies. Do not present mocked authentication as working authentication.

### D11. English first; translations later

Phase one uses an English interface and English complaint drafts. Translation support is deferred to the next phase. Uploaded labels may contain other languages; extracted text must be confirmed by the user.

### D12. Same-day phase-one target and parallel build

The product owner wants phase one ready today (5 September 2026, Asia/Kolkata), with multiple Claude or Codex agents contributing. Treat this as the delivery target, not a guarantee or permission to omit agreed scope. Establish shared contracts and clear file ownership before parallel implementation, and reserve time for integration and real end-to-end checks.

Reminders and translations may follow in the next two to three days; they remain outside phase one. This is sequencing intent, not authorization to schedule automated work or silently add those features now.

### D13. Invited pilot before public launch

Phase one is for invited test users. Phase two begins with public-launch readiness and launch, before reminders and translations. D06 remains the intended public browsing behaviour; the pilot's access boundary must be specified separately rather than assuming anonymous internet exposure is approved.

### D14. Service setup runs alongside implementation

This is a new project. The product owner will configure Supabase, Mixpanel, email/SMS delivery, Google sign-in, and hosting while implementation proceeds. No credentials or integrations are currently confirmed ready. Keep secrets out of documentation, source control, and chat. Provider readiness remains a dependency for live testing.

### D15. Fresh application with Git version control

Build a fresh application in its own Git repository. Preserve previous work as reference. Repository location, remote, and visibility have not been specified; do not assume permission to publish a public repository or overwrite an existing app.

### D16. Public introduction, invited pilot application

The public home page introduces FoodProof, explains its offer and how it differs from government portals, and provides pilot entry. Invited pilot users can access the feed and raise concerns. The public landing page does not make pilot reports publicly accessible. At public launch, D06's anonymous browsing behaviour applies.

Explain FoodProof as a community evidence and follow-up layer that helps users prepare complaints and navigate official channels. Do not claim it replaces the government process, has official affiliation, directly files complaints, or guarantees responses.

### D17. Product owner moderates

The product owner will review reports in the pilot. This resolves the unassigned reviewer in D02.

### D18. Demo identities now; real authentication and RBAC next

Explicit scope revision: phase one uses test identities such as `user@foodproof` and `reviewer@foodproof` to mock user and reviewer experiences. These are role labels, not verified or deliverable email addresses. Real email OTP, phone OTP, Google sign-in, and role-based access control move to phase two, before unrestricted public launch. This supersedes D10's phase-one requirement and D12's prohibition on cutting that scope: the product owner explicitly approved this cut.

Do not imply that simulated identity or role-specific UI is secure authentication or authorization. Clearly label demo mode. Recommended operational boundary: sample or redacted evidence only, no sensitive real-user evidence until actual identity and access controls are enforced. Do not expose a privileged Supabase key or disable database protections to make demo roles work.

Supabase persistence and Mixpanel remain requested; final technical design must distinguish demo data and test events from later production data.

### D19. Visual design delegated

The product owner has no specific visual preference. Use a coherent mobile-first design with readable evidence, clear reporting actions, and factual status language. Visual choices are implementation defaults, not a reason to delay the build.

### D20. Replace the initial visual direction using Impeccable

The user rejected the first wireframe treatment as too generic/AI-looking and requested modern layouts and purposeful animation using Impeccable. Existing visual defaults in FOODPROOF_SCREENS.md are therefore superseded pending the replacement design; functional workflows and scope remain intact.

The user chose polished image concepts first, followed by selection and implementation to match. No new visual direction is approved yet. The local Impeccable skill was found at `/Users/gaytrikhatwani/.claude/skills/impeccable/SKILL.md`. Its product context is PRODUCT.md; image-first workflow is recorded in `.impeccable/config.json`.

### D21. Shared Record selected; direct build for this revision

The design comparison page returned `optionId=model-pick` (The Shared Record) and `buildPath=code`, explicitly flipped for this session. Use the editorial concept image as the visual reference; build the interactive revision directly. The global image-first preference remains saved. Preserve product functionality; replace the old palette/card treatment with the selected design. Scope and evidence guardrails remain unchanged.

### D22. Explicit screenshot correction: Clear Signal is the chosen design

The user clarified with an attached screenshot that Clear Signal (blue sans-serif headline, warm-white background, magnified label photograph) is the intended choice. This overrides D21 and the comparison page's model-pick result. Do not continue the burgundy serif Shared Record direction. Use `../design/reference/approved-concept.png` as the portable visual reference. Preserve agreed functionality and purposeful motion.

### D23. Clear Signal preview approved; team review before build

The user approved the revised interactive Clear Signal preview and requested a complete documentation review before the team builds with coding agents. The approved design establishes the visual direction; prototype controls and in-memory state are not production implementation requirements or evidence of live integrations.

### D24. Repository supplied

GitHub remote: https://github.com/GaytriKhatwani/FoodProof.git. Local folder: /Users/gaytrikhatwani/ClaudeProjects/GovtCaseStudy/FoodProof/. This resolves the missing repository location in D15. Documentation handoff is authorized; no public launch or external complaint sending is authorized by this request.

## Approved refinements — 5 September 2026 (post team-review)

These refine, and do not rewrite, D01–D24. They record resolutions accepted after the documentation review. Historical decisions above stand unchanged.

### D25. Fictional seed data through application services

The pilot's seeded content is created by an operator seed script that calls the same domain and publication services and transactions as real reports — not raw database inserts. It creates a dedicated seed demo owner (`demo_access`), a clearly fictional report, a publication request, an owner-review approval, sanitized reviewed assets, and a separately reviewed simulated response. All seed rows are tagged demo/seed and captioned fictional. See FOODPROOF_TECHNICAL_SPEC.md §5a and FOODPROOF_SETUP_AND_OPERATIONS.md; T1 owns the script.

### D26. Preparation status is server-controlled

`reports.preparation` is server-derived and recalculated whenever confirmed facts or required evidence change, updated transactionally with the triggering mutation. It is never client-settable and has no direct transition endpoint.

### D27. Canonical product identity

One canonical normalization — trim, collapse internal whitespace, case-fold — applies to brand, product name and nullable variant. The uniqueness constraint and the match key use the same normalized key, with a null variant normalized to an empty string.

### D28. Persistent invitation-attempt limiter for Vercel

Phase one deploys to Vercel. The invitation-code attempt limiter is backed by the demo Supabase database: a keyed HMAC of the originating address keys a rolling-window row with a `UNIQUE(address_hmac, window_started_at)` constraint, incremented atomically via upsert, transaction or database function. It allows at most five failed attempts per 15-minute window, then returns the `RATE_LIMITED` response (HTTP 429) with `Retry-After` and the same generic response whether or not the code exists; a successful entry may clear the counter; expired rows are removed opportunistically with no scheduled job. `address_hmac` is short-lived pseudonymous security metadata used only for abuse limiting, never for analytics or profiling; the raw address is never stored and expired records are deleted. Implementation stays proportionate to the invited MVP.

### D29. Canonical T0 contract consolidation

`report_events`, fact confirmation, AI, product matching and aggregate-read contracts are part of the canonical T0 contract. The technical spec schema and the API supplement are explicitly cross-referenced so the dependency cannot be missed.

### D30. Analytics consent in `GET /api/me`

`GET /api/me` returns the current analytics-consent state so the persistent withdraw control can reflect it. It never returns invitation or session secrets.

### D31. Shipped navigation follows the approved preview

Shipped navigation follows the approved Clear Signal interactive preview. The concept image's "Log in" link is not part of phase one; phase one has no login flow, only invitation entry.

### D32. Phase-one security boundary restated

Production Supabase Auth, email OTP, phone OTP, Google sign-in and production RBAC remain phase two. Phase one still requires server-enforced invitation roles, ownership checks and reviewer-only operations. Visible test labels and client UI state confer no authority.

### D33. Live AI required for full phase-one acceptance

The product owner will provide an AI provider and budget before T4, so live extraction and drafting are required for full phase-one acceptance. The manual/template path remains mandatory and must work during provider failure. No provider or model is selected now; selection at T4 uses then-current official documentation, structured-output capability, evidence-data terms and budget.

## Next implementation boundary

Team review → assign integration owner → T0 shared contracts → bounded build tickets. Use the technical specification's invitation boundary. Real authentication stays in phase two. Outstanding service configuration is listed in FOODPROOF_SETUP_AND_OPERATIONS.md.

## Interpretation rule

These decisions refine the brief. For other unresolved topics, retain the brief's guardrails and label recommendations as provisional until settled.
