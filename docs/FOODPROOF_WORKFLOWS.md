# FoodProof — Workflow and state specification

Status: Reviewed build specification, 5 September 2026.
Authority: FOODPROOF_PRODUCT_BRIEF.md and FOODPROOF_DECISIONS.md. The proposed implementation defaults below are not additional user-approved product decisions.

## Release boundary

Phase one: public introduction page plus invited demo pilot, English, Supabase persistence and Mixpanel test events, external sending, and product-owner moderation. Test identities simulate user and reviewer journeys. Real email OTP, phone OTP, Google sign-in, and role enforcement move to phase two before public launch, reminders, and translations.

Use sample/redacted evidence for the demo; simulated role selection is not access control. The technical specification defines per-tester invitation codes and server sessions. Pilot evidence is not part of the public landing page.

## 0. Public introduction

Goal: understand FoodProof before entering the pilot.
System: explain evidence-backed community concerns, complaint preparation, external sending, and response tracking. Explain that official portals remain the route for official filing; FoodProof adds community visibility and organization. Provide pilot entry and a concise how-it-works section.

Acceptance: no invented impact statistics, endorsements, official affiliation, guaranteed outcomes, or live report previews leaking pilot data. Describe phase-one features accurately and identify demo mode on entry.

## 1. Browse a concern

Goal: understand a reported product concern and available evidence.
Trigger: open the feed or a concern link.
Action: search by product/brand; open a result.
System: show only approved public content, anonymous contributor attribution, observation/publication dates, approved evidence, and approved response history.
Next: return to results or contribute a separately evidenced report about the product.

Acceptance:

- No raw private report objects, uploader identity, original file URLs, or private correspondence are returned to readers.
- Empty search results say no reports were found, not that the product is safe.
- External submission status is sourced from recorded action, not publication.
- A linked report retains its own evidence, dates, and action history.

## 2. Pilot demo entry and later sign-in

Phase-one override: provide clearly labelled test-user and reviewer identities, using the requested labels as demo identifiers rather than email addresses. The product owner operates reviewer mode. Use the invitation/session mechanism in the technical specification; do not present a frontend role selector as secure access control. No real OTP messages or Google login are required in phase one.

The following authentication contract is retained for phase two:

Goal: save or manage a report.
Trigger: start a protected action or open My reports.
Action: choose email OTP, phone OTP, or Google.
System: authenticate through Supabase and return to the intended destination, subject to the agreed pilot access policy.

Acceptance:

- Explain invalid/expired codes and failed provider sign-in; allow retry without losing the intended destination.
- No simulated successful login when a provider is unavailable.
- Enforce account permissions server-side and in database/storage access rules.
- Proposed default: do not automatically merge email, phone, and Google accounts based on matching user-entered details. Account linking is deferred; explain that users should reuse their original sign-in method.

## 3. Create and save a private report

Goal: preserve evidence of a concern.
Action: enter product/brand, upload photos, describe the concern, and save.
System: save a private draft associated with the server-resolved demo actor (verified account owner in phase two); allow reopen and edit.

Fields:

| Field | Private draft | Publication request |
|---|---|---|
| Product name and brand | May be incomplete | Required |
| Product variant | Optional | Include when known |
| Product identity photo | May be missing | Required |
| Gluten-free claim photo | May be missing | Required |
| Ingredient-list photo | May be missing | Required |
| Concern explanation | May be incomplete | Required |
| Batch number and receipt | Optional | Optional |
| Observation date | Proposed field, optional | Display when supplied |

One photo may satisfy multiple evidence roles. Missing evidence blocks publication request, not private saving. A receipt is not a prerequisite.

Acceptance:

- Uploaded originals remain private.
- Failed uploads show retry/remove controls; do not claim evidence was saved before success.
- Draft saving has visible saving/saved/error states. Do not navigate away silently after a failed save.
- Proposed default: accept JPEG, PNG, and WebP label images, up to 3 MB each; provide a clear unsupported-format message. Validate limits on the server as well as the client. Final limits belong in the technical specification.

## 4. Review facts and prepare an action

Goal: produce a factual, editable message.
Action: review evidence and confirmed label text, select brand or official action, edit the draft.
System: prepare a message from confirmed facts, identifying missing information without inventing it.
Next: copy text/open the external destination, then optionally record the submission.

Acceptance:

- AI-extracted text is visibly unconfirmed until the user accepts or edits it.
- Manual entry and a structured draft remain available when AI fails.
- No automated safety conclusion or invented legal citation.
- Opening the user's email app does not attach evidence automatically or prove delivery; instructions must explain any manual attachment step.
- Brand recipient details are user-confirmed; do not guess email addresses.
- Official destinations must be verified before implementation; no unsupported direct filing claim.

## 5. Record external submission and follow-ups

Goal: keep track of actions performed outside FoodProof.
Action: choose brand or government, enter recipient/channel and submission date; optionally add a reference or acknowledgement.
System: append a user-recorded action to the correct history.

Acceptance:

- Keep brand and official records separate, including when both exist.
- Acknowledgement attachment means evidence attached, not independently authenticated.
- “No response recorded” is used when no response is saved.
- Users can manually record a follow-up action. No reminder fields, schedules, or notification jobs are built.

## 6. Request publication and moderate

Goal: share a concern without exposing private information.
Action: preview the public summary and selected assets, explicitly consent, request review.
System: snapshot the proposed content into a moderation queue. One designated reviewer approves, requests changes with a reason, or rejects with a reason.
Next: publish the approved snapshot or let the reporter correct and resubmit.

Acceptance:

- External submission is not required for publication.
- Review includes evidence completeness, factual wording, and personal-information exposure; it is not safety certification.
- Public identity is anonymous.
- Proposed default: edits to private source data never silently alter published content. Material public edits require a new review; keep the last approved version visible unless withdrawn or removed.
- Proposed default: owner withdrawal immediately removes public visibility, preserving the private record. Review requests for corrections/removal are available from concern details.
- Reviewer privileges are assigned administratively, never through a self-editable profile field.

## 7. Add a response

Goal: document what the brand or authority said.
Action: add sender, date, summary, and optional screenshot/document to the relevant submission.
System: save the response privately with user-provided provenance.
Next: optionally request publication of a redacted response summary and selected evidence.

Acceptance:

- A response does not automatically close a complaint.
- Public response updates require user request and moderation.
- Private attachments and contact information are not exposed through public response endpoints.

## 8. Close and reopen

Goal: stop or resume personal follow-up.
Action: close with a reason or reopen.
System: record the actor, time, and reason in history.

Acceptance:

- Use “Closed by reporter,” not a generic “Resolved” or “Safe” badge.
- Closure does not withdraw the public report.
- A label change is displayed as documented only after supporting evidence is reviewed.
- Proposed default: closure is at report level; submission/response histories remain intact and independently readable.

## State contracts

These are proposed internal state names implementing the agreed distinctions:

| Dimension | States / facts | Rule |
|---|---|---|
| Preparation | draft, ready | Ready means sufficient reviewed facts, not filed |
| Visibility | private, pending_review, changes_requested, rejected, published, withdrawn, removed | Approval controls public visibility |
| Reporter follow-up | open, closed_by_reporter | Can reopen; independent of publication |
| External action | channel opened; user-recorded submission; acknowledgement attached; response recorded | Derive from separate timestamped records per channel; never imply automatic sync |

Snapshot revisions should carry their own moderation state so a pending edit cannot overwrite an already approved public version. Final schema must preserve these distinctions even if implementation names differ.

## Required screen inventory

1. Public home page and separate pilot demo entry.
2. Feed/search with empty and loading states.
3. Public concern details and reviewed history.
4. Demo identity entry for phase one; real authentication with three methods and retry states in phase two.
5. Guided report editor: product, evidence, explanation, review.
6. Public preview and consent.
7. Action preparation and external handoff.
8. My reports and private report timeline.
9. Record submission/response and close/reopen controls.
10. Moderator queue and review detail.

These define screen responsibilities, not final wireframes or visual styling.

## Exit criteria for this document

Reviewer ownership, demo sessions, schema/access matrix, approved design, analytics dictionary, and build tickets are documented. Use FOODPROOF_ACCEPTANCE_CHECKLIST.md to verify the implementation. Simulated identity labels never replace server ownership checks; production authentication remains phase two.
