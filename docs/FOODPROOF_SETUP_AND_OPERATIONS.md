# FoodProof — Setup and pilot operations

Configuration status at handoff: repository supplied; local folder initially empty; no remote refs advertised by GitHub. Supabase, Mixpanel, AI and hosting are unverified. No application deployment has occurred.

## Responsibilities and readiness

| Item | Owner | Needed by |
|---|---|---|
| Name integration owner and assign tickets/branches | Team | T0 |
| Dedicated demo Supabase project and server secrets | Product owner + integration owner | T1 integration |
| Demo Mixpanel project, region/token, consent QA | Product owner + integration owner | T4 |
| Next-compatible host and deployed APP_ORIGIN | Product owner | T5; Vercel selected (D28); confirm deployed APP_ORIGIN |
| AI provider/model, credentials, input/data terms and bounded usage | Product owner + integration owner | Before T4; required for full phase-one acceptance (D33) |
| Verify official Food Safety Connect destination in browser | Integration owner | Enable official handoff |
| Moderator/contact channel and invited participant list | Product owner | Before distributing pilot access |

Missing services may not block UI development against labelled fixtures; they block claiming the associated integrated feature works. The original same-day target is historical. The team should estimate from the agreed P0 before promising a date.

## Configuration contract

Server configuration: SUPABASE_URL, SUPABASE_SECRET_KEY, MIXPANEL_TOKEN, MIXPANEL_API_HOST, APP_ORIGIN, RATE_LIMIT_HMAC_KEY, DEMO_MODE=true. AI_PROVIDER and provider-specific key/model are required for the AI path, which the owner commits to enabling before T4 (D33); no provider or model is selected in these documents. Use deployment secret storage and ignored local environment files. T0 creates `.env.example` with empty placeholders and exact validation rules, then README install/run/test commands verified against chosen versions.

No privileged key or invitation code enters frontend bundles, Markdown, Git or analytics. Do not use production projects for synthetic pilot records. Apply migrations deliberately, create private buckets, run allow/deny checks, seed clearly fictional products and the published pilot example via the seed script in FOODPROOF_TECHNICAL_SPEC.md §5a (it uses the application's own publication services and transactions, never raw inserts), and generate separate high-entropy user/reviewer invitations via an operator script. Do not automatically send invitations; owner distributes them.

Rate limiting must survive multiple app instances. Because phase one deploys to Vercel, the invitation-attempt limiter is the persistent Supabase-backed `demo_access_attempts` limiter defined in FOODPROOF_TECHNICAL_SPEC.md §2 and §4: at most five failed attempts per 15-minute window, keyed by a HMAC of the originating address (never the raw address), incremented atomically under a `UNIQUE(address_hmac, window_started_at)` constraint, returning HTTP 429 with `Retry-After` and the same generic response whether or not the code exists. `address_hmac` is short-lived pseudonymous security metadata used only for abuse limiting, never for analytics or profiling; expired rows are deleted opportunistically with no scheduled job. It needs the `RATE_LIMIT_HMAC_KEY` secret. This is a technical setup choice, not an excuse for an unguarded role picker.

## Moderator routine

Owner reviews submitted snapshots, not arbitrary private drafts. Check required evidence, factual wording, date/variant context, fictional/redacted-only demo boundary and absence of personal information. Approve exact content; otherwise request changes or reject with a useful reason. Do not edit an allegation into a different assertion without fresh reporter consent. Process private flags and remove with a reason when necessary. No guaranteed response-time SLA is claimed.

Review checks publication suitability, not clinical safety or a legal finding. A response, closure or documented label change must retain its precise meaning.

## Demo data lifecycle — implementation defaults

Use synthetic data wherever possible. Invites expire after seven days and sessions after eight hours as specified. At the end of the agreed pilot, revoke invitations and retain data only for the team's documented review period. Proposed review period: 30 days after the final session; owner confirms before inviting testers. Until confirmed, use synthetic data only. Delete demo database records and original/reviewed storage copies through an operator script with dry-run counts, project-ID guard and explicit operator confirmation. Deleting a live report is not an automatic consequence of withdrawal; withdrawal hides community content and preserves the private history.

If a tester needs deletion during the pilot, the owner handles it manually via the configured private contact route. Do not invent an email address. No scheduled retention jobs or reminders are required in P0. Do not migrate demo records into production identities automatically. Production retention/deletion/privacy wording is a separate public-launch gate.

## Deployment and recovery

Before pilot distribution: verify environment separation, public-home isolation, invitation revocation, storage guards, persistence, consent and actual analytics on the deployed URL. Keep a known working deployment/version reference. If access or data integrity breaks, revoke affected invites or disable pilot entry, retain the public introduction, and restore the last checked version after reviewing migration compatibility. Never run destructive resets against an unknown project.

No real complaint emails or government submissions are part of synthetic testing. Verify links and composer behaviour without sending. Record service readiness and unresolved dependencies in the build handoff.
