# FoodProof — API clarification for T0

These engineering defaults resolve gaps in the original technical document. They do not expand product scope. This document is a required part of the canonical T0 contract; read it with FOODPROOF_TECHNICAL_SPEC.md, whose §4 schema table is completed here (notably the `report_events` audit table). T0 must merge both into shared Zod schemas and migrations before UI/service agents diverge. Changes belong to the integration owner.

## Transport and identifiers

Use the technical specification's success/error envelope, UUID identifiers, UTC timestamps and version conflicts. Enumerate request fields explicitly and reject unknown fields; never pass request JSON directly into database updates. Session creation is rate-limited without an actor; idempotency receipts apply after a session exists. GETs never mutate data. Other mutations use logical operation UUIDs; token/consent responses must not be cached in generic operation receipt storage.

`actor_role` analytics mapping: database `user` → `reporter`, database `reviewer` → `reviewer`. UI role labels are never credentials.

`POST /api/demo/session`: `{ invitation_code }`; sets cookie and returns `{ label, role, expires_at }`. No raw invitation/session token in response JSON. `GET /api/me` returns `{ label, role, analytics_consent }` — the current consent state for the withdraw control — and never returns invitation or session secrets. `PUT /api/me/analytics-consent`: `{ allowed: boolean }`; server controls analytics identifiers. `/pilot` entry is public; all nested application routes are guarded.

### Email sign-in (phase two C.1)

Two additional endpoints run **alongside** invitation entry, behind the `EMAIL_SIGN_IN` deployment flag. They never replace `POST /api/demo/session`, and a verified account never claims a demo actor's records.

- `POST /api/auth/email/request`: `{ email }` (strict; trimmed, at most 254 characters, address shape). Answers `{ requested: true }`. The answer is identical whether or not that address already has an account, so the endpoint cannot be used to discover who has one. The one-time code travels only by email; it is never in a response, a log line or an analytics property.
- `POST /api/auth/email/verify`: `{ email, code }` (strict; `code` is a six to eight digit string, trimmed). On success it sets the same HttpOnly session cookie as invitation entry and returns `{ label, role, expires_at }`, the same three fields, so one client path handles both. `label` for a verified account is the constant `"Verified account"`; `role` comes from stored records and the deployed moderator allowlist, never from the body.
- Logout is `DELETE /api/demo/session` for **both** kinds of session. There is no separate email logout.

Error behaviour on these two routes:

| Situation | Code | HTTP | Message |
|---|---|---|---|
| `EMAIL_SIGN_IN` unset, or migration 0006 not applied | `DEPENDENCY_UNAVAILABLE` | 503 | Email sign-in is not enabled. |
| Malformed body, address or code | `VALIDATION_FAILED` | 422 | Validation failed. (with `fields`) |
| Cross-origin request | `FORBIDDEN` | 403 | Cross-origin request rejected. |
| Over the attempt limit | `RATE_LIMITED` | 429 | Too many sign-in attempts. Please wait and try again. (with `Retry-After`) |
| Provider could not send a code | `DEPENDENCY_UNAVAILABLE` | 503 | Could not send a sign-in code right now. Please try again shortly. |
| Wrong code, expired code, unconfirmed account, address does not match the code | `UNAUTHENTICATED` | 401 | That code is not valid. Request a new code and try again. |
| Actor revoked or expired | `FORBIDDEN` | 403 | This account cannot sign in. |

Every failed sign-in is one message: the four distinct causes of the 401 are deliberately indistinguishable. Both routes require same-origin, like every other cookie-authenticated mutation, and neither ever returns a provider token, a one-time code or a key.

Rate limits: each route counts **every** attempt against two independent buckets, the originating address and the destination address, in the existing persistent limiter (five per fifteen-minute window per bucket, 429 with `Retry-After`). Counting happens before the identity provider is contacted, so a capped caller never reaches it. A completed sign-in clears the verification counters; sending is never cleared, because sending is the thing being capped.

`GET /api/me` gains two fields, present for both kinds of session: `sign_in_method` (`"invitation" | "email"`) and `email` (the verified address, or `null` for an invitation actor). The address is read from the identity provider for that one response; no application table stores it, and `/api/me` is the only route that reads it. If the provider no longer accepts that account (deleted, or currently banned) the session is ended and the request answers `UNAUTHENTICATED`.

## Read models

- `GET /api/reports`: own-report summaries with report ID, product fields, preparation/lifecycle, visibility, version and updated time; cursor pagination, 20 per page.
- `GET /api/reports/:id`: owner-only aggregate of editable report fields, owned evidence metadata, complaint drafts, separate submissions, updates, review-request states/reasons, and publication status. Return guarded media IDs, never storage paths or secrets. This supports timeline and resume without undocumented client database queries.
- `GET /api/feed`: each card additionally carries `thumbnail_asset_id` — the guarded media ID of the reviewed IDENTITY photo of that approved revision, or null when the revision has none (revisions frozen before the three-role check existed). It is an ID for `GET /api/publication-assets/:id`, never a storage path or a public URL, and it is resolved for the returned page only. A card is only ever built for a currently visible publication, and the media route re-checks visibility per request, so withdrawal or removal stops the image.
- `GET /api/feed/:id`: approved projection only; `id` is report ID. Include approved response snapshots whose parent is visible; no private-derived status. Alongside `approved_asset_ids` (unchanged), return `approved_assets`: the same IDs in the same order, each with the label roles it shows. Asset roles are read from the owned source evidence the reviewed copy was made from — the frozen asset row stores only the copy — so a later role change by the reporter can change which approved image is described as the identity one; the bytes frozen for the revision never change. Both fields are additive and optional in the contract.
- Review reads return only submitted material needed for that queued case. A revision ID is distinct from report ID; use it consistently in the review detail route.

## Report and evidence writes

Report create/patch accepts product_name, brand, variant, observation_date, batch_number, concern_text, claim_text, ingredients_text and product_id (nullable). Server validates linked product and ownership. Patch includes expected_version. Lifecycle/publication and facts-confirmed timestamps cannot be set through arbitrary PATCH. `preparation` is likewise not an input field: the server derives it and persists it transactionally whenever confirmed facts or required evidence change (FOODPROOF_TECHNICAL_SPEC.md §4). Clients never set it.

Add `POST /api/reports/:id/confirm-facts` with `{ expected_version, claim_text, ingredients_text, method: manual|assisted }`. Confirmation is an explicit user action; method `assisted` requires a real assisted result. Save confirmed timestamp server-side. Later changes to label facts or required evidence clear confirmation and recompute readiness. Do not silently invalidate an existing immutable published snapshot.

Evidence kinds are `label`, `receipt`, `acknowledgement`, `response`. This corrects the earlier missing acknowledgement enum. Only ready label images with selected identity/claim/ingredients roles count toward report publication. Add `PATCH /api/evidence/:id` for owner role changes, with report expected_version; reject changes to pending-review source evidence or require withdrawing that request first. Replacement is a new upload followed by allowed removal. Validate attachment kind, report and matching submission/update before linking.

`POST /api/reports/:id/prepare`: `{ channel: brand|government }`; returns an editable deterministic subject/body without claiming save or send. `PUT .../complaint-drafts/:channel` saves it; expected_version is null for first creation, otherwise current integer. No template generation triggers a saved event until persistence succeeds.

## AI endpoints

Add owner-only `POST /api/reports/:id/ai/extract` with `{ evidence_ids: UUID[] }` and `POST /api/reports/:id/ai/draft` with `{ channel }`. Load facts/evidence server-side; do not accept arbitrary URLs or unbounded prompts. Extraction returns suggested fields and unreadable_fields, never updates confirmed facts automatically. Drafting requires confirmed facts and returns an editable suggestion; saving is separate.

Provider/model and budgets are setup dependencies. Enforce per-session rate limits and a timeout; show manual fallback on provider failure. No live AI claim from deterministic templates. Do not log evidence, prompts or outputs by default.

## Product linkage

Add guarded `GET /api/products/matches?brand=&name=&variant=` for exact normalized matching only. Never log query text to analytics. Use the one canonical normalization `norm(x)` — trim, collapse internal whitespace, then case-fold — over brand, name and variant, with a null variant normalized to an empty string. The same normalized key `(norm(brand), norm(name), coalesce(norm(variant),''))` backs both matching and the `products` uniqueness constraint (FOODPROOF_TECHNICAL_SPEC.md §4), so they never disagree; preserve the entered display text. User confirms a candidate. If none is chosen, create/reuse the exact identity transactionally at readiness/publication time; avoid catalogue records from empty drafts. Do not automatically fuzzy-merge. Reviewer relinking logs old/new product IDs and reason; public identity corrections require a new consented revision, not silent mutation of approved text.

## Publication and moderation

Publication request: `{ expected_version, consent: true, selected_evidence_ids, source_update_id?: UUID }`. Server constructs the allowlisted snapshot from owned persisted data and validates selected roles. It must not trust a client-supplied arbitrary public payload.

Concern revisions require the three evidence roles plus confirmed facts. Response revisions require a visible approved parent concern, a matching private response with sender/date/summary, explicit consent and only selected eligible sanitized images. Optional response evidence is not forced to cover label roles. A response snapshot never replaces the concern publication pointer.

Decisions: `{ expected_version, action: approve|request_changes|reject, reason? }`. Map API actions to stored `approved|changes_requested|rejected`; analytics uses its separate enum `approved|changes_requested|rejected|removed`. One transaction performs decision, pointer and asset-visibility changes. Stale/repeated approval cannot resurrect withdrawn content.

Add a narrow `report_events` audit table (id, report_id, actor_access_id, type, occurred_at, related_entity_id, metadata allowlist) for internal saves, review requests/decisions, withdrawal and relinking. Existing `updates` stores external/manual follow-up and closure history. Merge these sources for the owner timeline without treating analytics as the audit log. Server alone writes internal events; keep private reasons out of projections.

## Analytics

`POST /api/analytics`: `{ event_name, event_id, occurred_at, properties }` for allowlisted client-owned events. Derive actor, role, consent, audience, session, mode and app version server-side; reject payload attempts to override them. Mutations emit success server-side after commit. Browser view/copy/handoff events cannot claim report save/publication success. Match the exact event dictionary; API analytics failure never blocks the main action.
