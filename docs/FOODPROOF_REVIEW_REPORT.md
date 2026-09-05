# FoodProof — Documentation review

Reviewed 5 September 2026 against the decisions in this conversation and the generated session documents. This is a document-consistency review, not an independent legal review or application test.

## Assessment

Ready for the team's pre-build review and T0 planning. Product discovery is complete, Clear Signal is explicitly approved and the repository is supplied. The application is not implemented. The post-review refinements (D25–D33) are folded into the contracts, closing the seed-data, preparation-status, product-identity, invitation-limiter, contract-consolidation, consent-read, navigation, security-boundary and AI-acceptance items. Service configuration remains open below; no integration or launch is certified by this review.

## Corrections made

| Finding | Resolution |
|---|---|
| Brief still required public browsing and Supabase Auth in phase one | Restricted invited demo now explicit; all three real sign-in methods and public browsing remain phase two |
| Handoff described design as unapproved and repository as missing | Recorded explicit approval D23 and supplied repository D24; updated current documents |
| Historical visual notes could restart burgundy/teal design | DESIGN.md and portable Clear Signal reference govern; old decisions explicitly historical |
| Spec assumed `/pilot/*` protection but entry also lives under `/pilot` | Entry is public; nested application/data routes protected |
| Acknowledgement uploads had no matching evidence enum | Added acknowledgement kind consistently |
| AI/fact confirmation/product matching and timeline reads lacked explicit interfaces | API supplement defines bounded endpoints, read models and audit requirements for T0 |
| Analytics role-change behaviour contradicted invitation sessions | Role change now requires new invitation session and fresh analytics IDs |
| Preview omitted real persistence, access and failure-state behaviour | Prototype-to-build mapping lists required replacements and missing implementation |
| Earlier brief still instructed creation of already completed documents | Replaced stale next steps with team review and staged build |
| Portable onboarding, acceptance and operational instructions missing | Added PRD, root AGENTS, agent prompts, setup guide and acceptance matrix |

## Post-review refinements (5 September 2026)

Accepted after the review above and recorded as D25–D33. Historical decisions were not rewritten.

| Finding | Resolution | Files |
|---|---|---|
| Seeded published example had no defined creation path or owner | Seed script uses the same publication services/transactions: seed owner, fictional report, publication request, owner approval, sanitized assets, separately reviewed simulated response; no raw inserts (D25) | Technical spec §5a, §4; setup/operations; tickets T1; measurement §6 |
| `reports.preparation` write semantics unspecified | Server-controlled, recomputed on facts/evidence change, persisted transactionally, never client-set (D26) | Technical spec §4; API supplement |
| `products` identity not uniquely enforced; match index omitted variant | Canonical `norm(x)` over brand/name/variant with one unique key shared by matching and uniqueness (D27) | Technical spec §4; API supplement |
| Vercel invitation-attempt limiter mechanism unspecified | Persistent Supabase `demo_access_attempts` limiter: `UNIQUE(address_hmac, window_started_at)`, atomic increment, five failed attempts per 15-minute window, HTTP 429 with `Retry-After`, generic response regardless of code validity, opportunistic deletion; `address_hmac` is short-lived pseudonymous security metadata (never analytics/profiling), `RATE_LIMIT_HMAC_KEY` (D28) | Technical spec §2, §4, §6, §9; decisions; setup/operations; measurement |
| Canonical contract split across two documents | `report_events` added to the schema table; explicit "required part of the canonical contract" notes both ways (D29) | Technical spec §4, clarifications; API supplement |
| No read for current analytics consent | `GET /api/me` returns `analytics_consent` (D30) | Technical spec §6; API supplement |
| Concept image nav differed from functional header | Shipped nav follows the approved interactive preview; no phase-one "Log in" (D31) | Screens shared-interaction contract |
| Phase-one security boundary needed restating | Production Auth/OTP/Google/RBAC are phase two; phase one still enforces invitation roles, ownership and reviewer-only ops server-side; labels/UI confer no authority (D32) | Technical spec §7; decision log |
| AI acceptance status ambiguous | Owner provides provider/budget before T4; live AI required for full acceptance; manual path mandatory and must survive provider failure; no provider/model named (D33) | PRD; technical spec §8; acceptance checklist; tickets T4 |

## Coverage of the conversation

Vision/community voice; completed interviews and evidence limitations; public introduction; invited feed and reporting; private drafts; identity/claim/ingredient photos; optional receipt/batch; anonymous reviewed sharing; owner moderation; external brand/government actions and separate tracking; private responses with separate review; closure/reopen; English; deferred reminders/translations; mocked labels now and all three real authentication methods later; fresh Git/Supabase/Mixpanel build; AI confirmation/manual fallback; approved Clear Signal; staged multi-agent work are documented.

## Open items and when they block

| Item | State / next action | Blocks |
|---|---|---|
| Integration owner and assignments | Team names owner at review | Parallel implementation |
| Supabase/Mixpanel project credentials and region | Owner configures privately; engineer verifies | Integrated pilot, not static UI |
| AI provider/model, data terms and budgets | Owner commits to provide before T4 (D33); still select model and confirm data terms | Full phase-one AI acceptance; manual loop stays mandatory |
| Hosting destination | Vercel selected (D28); owner confirms deployed APP_ORIGIN | Deployment |
| Official portal destination | Candidate in technical spec remains unverified; browser-check before enabling | Official outbound link |
| Contact channel / moderator operations | Owner supplies private route; no invented address | Invited operation |
| Demo review-period retention | 30 days proposed; owner confirms, synthetic only meanwhile | Use of anything beyond synthetic fixtures |
| Production privacy/retention/auth/linking/abuse handling | Explicit phase-two gate | Public launch, not this demo build |

Research provenance: this package carries the owner's reported findings, not a redistributed original Dharit report or independently verified allegations. Source permission/review is required before using those examples publicly. No source evidence is fabricated to fill that gap.

## Validation performed

- Read and cross-checked all ten existing top-level product/design Markdown documents from the session.
- Checked local target folder was empty and supplied GitHub remote advertised no refs.
- Preserved current decisions with historical overrides and a clear read order.
- Bundled portable design preview, chosen concept and fictional image provenance.
- Checked local Markdown links and handoff file inventory before transfer.

The previous preview had local browser checks only. All new application acceptance items start as not run. A secondary documentation agent previously hit a usage limit; this handoff review was performed by the primary agent, not claimed as an independent team approval.

## Next action

Team reviews the PRD, this report and build sequence, assigns the integration owner and begins T0. Resolve configuration alongside development. Maintain this repository as the shared source of truth instead of copying disconnected prompts between tools.
