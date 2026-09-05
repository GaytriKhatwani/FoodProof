# FoodProof — API clarification for T0

These engineering defaults resolve gaps in the original technical document. They do not expand product scope. This document is a required part of the canonical T0 contract; read it with FOODPROOF_TECHNICAL_SPEC.md, whose §4 schema table is completed here (notably the `report_events` audit table). T0 must merge both into shared Zod schemas and migrations before UI/service agents diverge. Changes belong to the integration owner.

## Transport and identifiers

Use the technical specification's success/error envelope, UUID identifiers, UTC timestamps and version conflicts. Enumerate request fields explicitly and reject unknown fields; never pass request JSON directly into database updates. Session creation is rate-limited without an actor; idempotency receipts apply after a session exists. GETs never mutate data. Other mutations use logical operation UUIDs; token/consent responses must not be cached in generic operation receipt storage.

`actor_role` analytics mapping: database `user` → `reporter`, database `reviewer` → `reviewer`. UI role labels are never credentials.

`POST /api/demo/session`: `{ invitation_code }`; sets cookie and returns `{ label, role, expires_at }`. No raw invitation/session token in response JSON. `GET /api/me` returns `{ label, role, analytics_consent }` — the current consent state for the withdraw control — and never returns invitation or session secrets. `PUT /api/me/analytics-consent`: `{ allowed: boolean }`; server controls analytics identifiers. `/pilot` entry is public; all nested application routes are guarded.

## Read models

- `GET /api/reports`: own-report summaries with report ID, product fields, preparation/lifecycle, visibility, version and updated time; cursor pagination, 20 per page.
- `GET /api/reports/:id`: owner-only aggregate of editable report fields, owned evidence metadata, complaint drafts, separate submissions, updates, review-request states/reasons, and publication status. Return guarded media IDs, never storage paths or secrets. This supports timeline and resume without undocumented client database queries.
- `GET /api/feed/:id`: approved projection only; `id` is report ID. Include approved response snapshots whose parent is visible; no private-derived status.
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
