# FoodProof — Setup and pilot operations

Configuration status at handoff: repository supplied; local folder initially empty; no remote refs advertised by GitHub. Supabase, Mixpanel, AI and hosting are unverified. No application deployment has occurred. *(Historical. Status as of 6 September 2026: Supabase, the AI provider and Mixpanel are configured and verified for the demo project — see "T4 operations" at the end of this document and `IMPLEMENTATION_STATUS.md`.)*

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

Use synthetic data wherever possible. Invites expire after seven days and sessions after eight hours as specified. At the end of the agreed pilot, revoke invitations and retain data only for the team's documented review period. Proposed review period: 30 days after the final session; owner confirms before inviting testers. Until confirmed, use synthetic data only. **Owner decision, 6 September 2026:** the *provider's* (Anthropic API) standard retention is accepted for synthetic-only testing with AI enabled — this does not authorise real tester data, personal details or real user photographs, and is revisited only if real user data is introduced. FoodProof's *own* pilot-data deletion schedule is a separate, still-open owner decision. The private contact/moderator route is `gayatrikhatwani@gmail.com`. Delete demo database records and original/reviewed storage copies through an operator script with dry-run counts, project-ID guard and explicit operator confirmation. Deleting a live report is not an automatic consequence of withdrawal; withdrawal hides community content and preserves the private history.

If a tester needs deletion during the pilot, the owner handles it manually via the configured private contact route. Do not invent an email address. No scheduled retention jobs or reminders are required in P0. Do not migrate demo records into production identities automatically. Production retention/deletion/privacy wording is a separate public-launch gate.

## Deployment and recovery

Before pilot distribution: verify environment separation, public-home isolation, invitation revocation, storage guards, persistence, consent and actual analytics on the deployed URL. Keep a known working deployment/version reference. If access or data integrity breaks, revoke affected invites or disable pilot entry, retain the public introduction, and restore the last checked version after reviewing migration compatibility. Never run destructive resets against an unknown project.

No real complaint emails or government submissions are part of synthetic testing. Verify links and composer behaviour without sending. Record service readiness and unresolved dependencies in the build handoff.

## T4 operations — AI assistance and analytics (6 September 2026)

### AI provider configuration

- **Selected:** Anthropic Claude API, model `claude-sonnet-5` (Sonnet tier, latest generation at selection; pin another id with `AI_MODEL`), `effort: low`, structured JSON outputs, SDK `@anthropic-ai/sdk` 0.124.0. Requests go to the Anthropic-hosted API; no inference region is pinned.
- **Variables (server-only, deployment secret storage or the ignored `.env.local`):** `AI_PROVIDER=anthropic`, `AI_PROVIDER_API_KEY`, optional `AI_MODEL`. Blank or missing values switch the AI path off cleanly: `GET /api/me` reports `ai_available: false`, no AI control is shown, the `/ai` routes answer 503, and the manual / template path is unaffected. `GET /api/health` reports the `ai` group as a boolean.
- **Hard limits (code, `lib/server/ai/limits.ts`; changing them is a code change):** ≤ 3 label photographs per call, ≤ 3 MB each, jpeg/png/webp only; 30 s per attempt, one retry, 62 s hard deadline; 1024 / 1500 output tokens; USD 0.06 per call, USD 0.50 per invitation, USD 2.00 for the pilot; 6 calls per 60 s per invitation. The owner's decision was a USD 2.00 total cap.
- **Spend ledger:** `ai_spend_ledger` (migration 0004) holds one row per call with reserved and settled micro-USD, token counts, model, operation and channel — never prompts, images, extracted text or drafts. Check the running total with `select fp_ai_spend_totals();` (`effective_micros` is what counts against the cap; `reserved_open` > 0 means a call crashed between reservation and settlement and is being counted at its estimate). Once the pilot cap is reached every assisted call answers "AI assistance is unavailable." until the ledger is reduced by an operator (there is no automatic reset). Test suites clean up their own rows.
- **Data handling (provider's official documentation, checked 6 September 2026):** under Anthropic's Commercial Terms, API inputs and outputs — including the label photographs and confirmed complaint text this feature sends — are **not used to train models by default**. They are, however, **retained for up to 30 days** under the standard API arrangement (longer only if a request is flagged for a Trust & Safety review); **zero-data-retention is not in effect for this pilot** and would require a separate qualifying arrangement with Anthropic. `claude-sonnet-5` runs under this standard arrangement; it is not configured for zero retention. The integration itself never logs evidence, prompts, extracted text or drafts; FoodProof's own server logs carry a content-free failure reason and a ledger id only. The reporter's confirmed facts and concern text (their own words) are sent for drafting; label photographs are sent for extraction only after ownership, kind, type and size checks, and only the images the reporter selected for that call are sent — never other report data or unselected evidence — and each image has its metadata (EXIF/XMP: possibly location, device, time) stripped before it leaves, the same way a reviewed copy is; only the pixels travel. Because this data leaves FoodProof for a third-party processor, a concise disclosure is shown to the reporter before the first assisted extraction or draft and the feature runs only on a deliberate action (`components/reporter/AiDisclosure`); this is separate from, and never implied by, Mixpanel analytics consent.
- **Behavioural guarantees to re-check after any prompt change** (`lib/server/ai/anthropic.ts`, `AI_SYSTEM_RULES`): photograph text is evidence, never an instruction; no invented ingredients, claims, dates, brand responses, regulatory requirements, safety conclusions or complaint status; never "safe"/"unsafe"; never a claim that a complaint was filed. `tests/integration/ai.test.ts` exercises a prompt-injection label and a blank image against the live model.

### Analytics operations

- **Project:** the dedicated demo Mixpanel project (`MIXPANEL_TOKEN`, regional `MIXPANEL_API_HOST`). Never point the demo at a production project. The server is the only sender (`POST /track?verbose=1`); no browser SDK exists, so autocapture, profiles, session replay and automatic page tracking cannot occur.
- **Audience:** `ANALYTICS_AUDIENCE=qa` on local/QA machines; unset (= `invited_pilot`) on the deployment testers use. An invalid value fails startup rather than mislabelling traffic.
- **Verification without a service account:** start the app, run `node --env-file=.env.local scripts/analytics-journey.mjs`, copy the printed `analytics_actor_id`, and in Live View filter on that `distinct_id`. Expect exactly the printed consented events in order with matching `$insert_id`s; open one and confirm the properties are only the envelope (`analytics_actor_id`, `session_id`, `analytics_mode`, `audience`, `actor_role`, `app_version`, `schema_version`) plus the dictionary fields — no product name, recipient, reference, claim/ingredient text, closure reason or file path. Review what Mixpanel itself adds (for example `$city`, `mp_country_code`, `$lib_version`) before inviting testers (measurement doc §2). The declined-consent section must produce nothing; the withdrawn section must show only the events before withdrawal.
- **Retries:** a mutation replayed with the same `Idempotency-Key` re-sends the same `$insert_id` and timestamp; Mixpanel keeps one copy. Do not "fix" duplicates by hand.

### Deployment checklist additions (T5)

Set the three AI variables on Vercel; confirm `GET /api/health` reports `ai: true`; perform one assisted extraction and one assisted draft on the deployment with the fictional label; check `select fp_ai_spend_totals();` afterwards; leave `ANALYTICS_AUDIENCE` unset there.

## Phase two C.1 — email sign-in operations

Email sign-in adds a verified-account path **alongside** invitation entry. Invitation codes keep working exactly as before. A verified account never inherits a demo actor's reports, evidence or publications. Leaving the feature switched off costs nothing: the two sign-in routes answer 503 "Email sign-in is not enabled." and every other behaviour is unchanged.

**Enable it in this order. The migration comes first.**

1. **Apply the migration.** Paste `supabase/migrations/0006_verified_accounts.sql` into the Supabase SQL Editor of the demo project and run it, after 0001 to 0005. Confirm with `select fp_schema_version();`. It must return 6. If `fp_verified_actor` later reports "permission denied for table users", run the two grants recorded in that file's header and re-run it.
2. **Enable the email provider.** Supabase dashboard, Authentication, Sign In / Providers: turn **Email** on, with **Confirm email** on. Leave phone and every social provider off; this ticket is email only.
3. **Put the code in the email.** Authentication, Emails, template **Magic Link**: the default body contains only a link. Add `{{ .Token }}` so the message carries the one-time code the sign-in screen asks for. Keeping the link as well is harmless, but the code is what FoodProof verifies.
4. **Set the code lifetime.** Authentication, Providers, Email: set the OTP expiry to a short window, one hour or less. A longer expiry widens the guessing window for no user benefit.
5. **Configure custom SMTP.** Authentication, Emails, SMTP Settings. This is not optional for a pilot: Supabase's built-in email service delivers **only to members of the Supabase project team** and is heavily rate limited, so invited testers on other addresses simply never receive a code. Point it at your own transactional email provider and set a sender address the testers will recognise.
6. **Set the auth rate limits.** Authentication, Rate Limits: keep the per-hour email send limit within what your SMTP plan can serve, and keep token verification conservative. These are the provider's own limits. FoodProof applies its own limiter first (below), so the provider limit is a second line of defence, not the first.
7. **Set the Vercel variables.** `EMAIL_SIGN_IN=true`, `SUPABASE_PUBLISHABLE_KEY` (the project's publishable `sb_publishable_...` key), and `MODERATOR_EMAILS` if any verified account should be a reviewer. All three are server-side; none is `NEXT_PUBLIC_`. Setting `EMAIL_SIGN_IN=true` without the publishable key is a startup error, on purpose.
8. **Check it.** `GET /api/health` reports `email_sign_in: true` once both are set. Sign in with one address, confirm `GET /api/me` shows `sign_in_method: "email"` and that address, and confirm an invitation code still works in a separate browser.

If step 7 is done before step 1, nothing breaks for existing testers: the application logs one line naming the missing migration, keeps invitation entry working, and refuses email sign-in until 0006 is applied.

**Moderators.** The reviewer role for verified accounts comes from `MODERATOR_EMAILS` alone, a comma-separated list compared case-insensitively. There is no role table and no way to grant a role from a browser. Adding an address promotes that account on its next request; removing one demotes it on its next request. Invitation actors are unaffected: their role still comes from the invitation they used.

**FoodProof's own rate limits.** Both routes count every attempt in two buckets, the originating address and the destination address, using the existing persistent limiter: five attempts per fifteen-minute window in each bucket, answering 429 with `Retry-After`. Sending is counted whether or not it succeeds, so the endpoint cannot be used to flood one mailbox. Verification counters are cleared only by a completed sign-in.

**Revoking a verified actor.** Set `revoked_at` on that person's `demo_access` row, exactly as for an invitation:

```sql
update demo_access set revoked_at = now() where id = '<actor id>';
```

Their current session stops resolving on the next request, and signing in again is refused. Their content is preserved. Clear `revoked_at` to restore access.

**Deleting an account, in order.** `demo_access.auth_user_id` references `auth.users` with ON DELETE RESTRICT, so an account cannot be removed while pilot content still points at it. That is deliberate: deleting an account must never silently destroy or orphan reports.

1. Decide what happens to that person's reports, evidence and publications, and delete them first if they are to go, in the child-to-parent order `scripts/teardown.mjs` uses.
2. Delete their `demo_access` row.
3. Delete the account in the Supabase dashboard under Authentication, Users, or through the admin API.

`node --env-file=.env.local scripts/teardown.mjs` does all three for the whole demo project, counts the accounts in its dry run, and still requires `--confirm` and a matching `--project` reference.

**What the identity provider stores.** The address itself lives only in Supabase Auth (`auth.users`), with the provider's own sign-in metadata: the account identifier, confirmation and last-sign-in timestamps. FoodProof's tables never store the address. They hold a keyed HMAC of it (`demo_access.email_hmac`), which is pseudonymous operational metadata for support and the moderator check and cannot be reversed to the address, plus the fixed label "Verified account". No address, code or provider token is ever written to an analytics event, a log line, or any response other than the signed-in person's own `GET /api/me`. Codes are delivered by the SMTP provider configured in step 5, which sees both the address and the code; choose it with that in mind.
