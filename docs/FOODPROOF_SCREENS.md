# FoodProof — Screen and wireframe specification

Status: build specification, 5 September 2026. Read with FOODPROOF_DECISIONS.md, FOODPROOF_WORKFLOWS.md, and the technical contract. Latest approved decisions take precedence. Layout, copy, routes, and visual values here are implementation defaults selected to avoid blocking the build; they do not expand product scope.

VISUAL REVISION: D22 selects Clear Signal (blue sans-serif concept). The user approved the revised preview. DESIGN.md and ../design/foodproof-clear-signal.html govern visual layout; the text sketches below specify functional content, not pixel layouts. The prototype demonstrates interactions locally; the full technical contract still governs implementation.

## Shared interaction contract

Phase one has a public introduction and an invited demo. Feed items and reports remain inside the pilot; “public” preview means the version approved for the pilot community, not internet publication. Use “Community visibility” in pilot UI and “Preview community version” on the consent screen. Sample/redacted records only. Demo identities simulate ownership and roles; they are not verified accounts. Never display sample activity as real cases, brand responses, or impact.

Public header: FoodProof wordmark; How it works anchor; “Enter pilot”. Pilot header: wordmark, persistent “Demo · sample/redacted data” label, current role label, “Exit demo”. Mobile navigation: Feed, Raise a concern, My reports; reviewer mode adds Review. A role change requires exiting and entering with the corresponding invitation and is not described as authentication. Pilot access restriction follows the technical contract, not a hidden URL or UI toggle. Shipped navigation follows the approved Clear Signal interactive preview (D31); the static concept image's "Log in" item is not part of phase one, which has no login flow — only invitation entry.

Use one primary action per section. Keep page titles concrete. Report status is three separate pieces: preparation, community visibility, and personal follow-up. Brand and official action cards show their own recorded history. Never use a composite progress bar suggesting government processing. Toasts supplement persistent inline save confirmation; they do not replace it.

### Visual and accessibility defaults

- Visual source of truth: DESIGN.md and the Clear Signal prototype (D22). Use their cobalt/navy palette, bold typography, open layouts, and responsive spacing. Validate rendered contrast and touch targets before release.
- Visible labels, semantic headings, keyboard operation, visible focus, error summaries linked to fields, and live announcements for upload/save changes. Modals trap focus and return it to the trigger. Evidence viewer supports zoom and keyboard close; require descriptive role labels for images. Status never relies on colour alone.
- Form values survive validation and recoverable network failures. Show “Saving…”, “Saved”, or “Couldn’t save. Retry”; never show successful persistence from local state alone. Confirm navigation when unsaved work could be lost. No skeleton that hides a failure indefinitely.

## 1. Public home — `/`

Goal: understand FoodProof and its relationship to official channels.

```text
FoodProof                                      [Enter pilot]
Food labels deserve a closer look.
Document a concern. Prepare a complaint.
Give the community a clearer picture.
[Enter invited pilot]       [How it works ↓]

Document              Take action              Follow the record
Label photos          Draft + external send    Responses + community

How FoodProof complements official channels
FoodProof: organize evidence, prepare messages, share reviewed concerns.
Official portals: submit complaints through the responsible authority.
Publishing here does not file a government complaint.

Pilot notice: invited demo using sample or redacted information.
Footer: independent project; no government affiliation; contact route
```

“Enter invited pilot” opens entry; it does not expose feed data. No pilot report previews or live activity counts. Static illustrations/examples must say “Illustrative example”. No government logo, guaranteed outcome, safety lookup claim, or fake testimonial. Contact route must be configured by the owner rather than invented.

## 2. Pilot entry — `/pilot`

```text
FoodProof pilot
This demo uses sample/redacted information and simulated roles.
[Invitation code ____________________]
Your invitation determines the experience:
Demo user — user@foodproof / Demo reviewer — reviewer@foodproof
[Enter demo]
These are test labels, not email accounts. Do not enter personal evidence.
```

User enters Feed; reviewer enters Review queue. Preserve a requested pilot destination when appropriate. The invitation code is a masked field; do not show an email/account-password form, OTP button, Google button, or “authenticated” message in phase one. Access failure shows a retry and owner contact route without leaking pilot content. An unavailable backend shows an explicit unavailable state; do not silently fall back to local demo persistence. Exit clears the demo session and returns home. Ask for optional usage-analytics consent with equally available allow/decline choices; add a small analytics preference control in the pilot shell to withdraw later.

## 3. Community feed — `/pilot/feed`

```text
Community concerns                     [Raise a concern]
[Search product or brand __________________]
Reviewed reports describe concerns; they do not establish product safety.

[Approved identity photo] Product · variant
Brand · Sample report
Concern excerpt (2 lines)
Published date · Anonymous contributor
No external submission recorded / User-recorded action available
[View concern]
```

Default order: newest publication first. Search product/brand only; no popularity rankings, comments, or likes. “View concern” opens the approved version. Distinct reports about the same product remain separately attributed and evidenced; detail can link related reports. Empty feed: “No reviewed concerns yet” plus Raise a concern. Empty search: “No reports match this search. This does not establish product safety” plus Clear search. Loading preserves the open record layout; failure provides Retry. Never fetch private originals into this screen.

## 4. Community concern detail — `/pilot/concerns/:reportId`

```text
[Back to feed]
Product · variant / Brand                  Sample report
Anonymous contributor · observed [if supplied] · published [date]
Reported concern
[Approved factual summary]
Evidence
[Product identity] [Gluten-free claim] [Ingredients] → zoom
Label claim: [confirmed quoted text, if supplied]
Ingredients: [confirmed quoted text, if supplied]

Recorded actions and reviewed updates
Brand: No submission recorded / user-recorded submission [date]
Official: No submission recorded / user-recorded submission [date]
[Approved response summaries, provenance, dates]

[Report your own experience with this product]
[Flag a concern or request a correction]
```

Contribution creates a new draft linked to the same product, prefilled with product identity fields only; it does not copy another person's evidence, complaint, or history. Correction dialog accepts a reason, optional detail, and queues it privately for the owner; confirmation says “Request recorded for review”. No invented response-time promise. Unpublished/withdrawn/unknown IDs return “This concern is not available” without private content. Reviewed correspondence must redact contact details. “No response recorded” is accurate when no shareable response exists; do not assert that a brand ignored someone. “Reviewed for publication” explains completeness/privacy review, not safety certification.

## 5. Guided report editor — `/pilot/reports/new` and `/pilot/reports/:id/edit`

Four labelled steps with Back, Save draft, and Continue. Steps may be revisited. Saving incomplete data is always allowed; publication validation is later. Every step displays sample/redacted-only guidance.

```text
Raise a concern                        Draft · save state
1 Product → 2 Evidence → 3 Concern → 4 Review
[Current step contents]
[Back]                      [Save draft] [Continue]
```

1. **Product:** product name, brand, optional variant, observation date, batch number. For linked reports show the linked product and allow correcting mistaken linkage; changing identity must not silently mutate a shared product. No speculative catalogue matching.
2. **Evidence:** upload images; each successful image has preview, assigned roles (identity / claim / ingredients), replace/remove, and upload state. One image can have multiple roles. Optional receipt is separate and not selected for community sharing by default. Accept formats/limits from the technical contract and display them before upload. Handle unsupported format, size, failure, unreadable image, and retry independently per image.
3. **Concern:** plain-language explanation; optional confirmed claim and ingredient text. If extraction is enabled, label output “Suggested text — check against your photo”; require confirmation or correction. Manual entry works without AI. No risk score or legal verdict.
4. **Review:** show fields and evidence with Edit links and missing-publication checklist. “Save report” persists and opens the private timeline. It neither publishes nor contacts anyone. Draft may be incomplete. Ready status follows the technical validation contract; do not equate ready with external filing.

No AI control appears enabled unless its backend is configured. An AI failure offers manual entry and preserves work. File deletions and replacement follow the technical evidence/version contract so published snapshots never break.

## 6. Community preview and consent — `/pilot/reports/:id/share`

```text
Preview community version
Only the information below will be proposed for sharing in this pilot.
[Anonymous product concern card + explanation + selected images]
[Select eligible images]             [Edit private report]
Not included: account label, receipts by default, private correspondence.

[ ] I want this version and these selected images shared after review.
[Request publication review]                        [Keep private]
```

Required photos must cover identity, claim, and ingredients; require product, brand, explanation. Show missing items with direct edit links. Consent unchecked by default. Block submission while required uploads are incomplete. Provide explicit selected-asset preview: automatic redaction is not promised; if private details are visible, replace with a redacted copy before requesting review. “Request publication review” creates a versioned request and opens timeline with Pending review. It does not file externally. Keep private returns unchanged.

Changes requested/rejected show reviewer reason and Edit and resubmit. Published state offers “Request review of changes” and “Withdraw community sharing”. Withdrawal immediately hides the community version while preserving the private report; explain this effect in a confirmation. Pending edits never overwrite the last approved version.

## 7. Action preparation and handoff — `/pilot/reports/:id/actions`

```text
Prepare a complaint
[Brand message] [Official complaint]
Confirmed facts + missing information checklist
[Editable draft body __________________________]
[Save draft] [Copy message]
Brand: [Recipient email — user confirms] [Open email app]
Official: [Configured official destination] [Open official portal ↗]

You send outside FoodProof. Opening a destination is not submission.
Evidence must be attached manually where required.
[Record a submission]
```

Use deterministic factual draft as baseline; optional AI rewrite cannot add unsupported facts. Save confirmation occurs after persistence. No guessed brand address. Official links must be verified/configured before enabling; show “Official destination not configured” if unavailable. Brand email opening must not claim files were attached. Browser failure retains Copy message and user-visible destination. All external actions require deliberate clicks and never auto-send.

Record submission opens a dialog: brand/official channel, recipient or authority, sent date, optional reference, optional acknowledgement. CTA “Save submission record” then timeline “Submission recorded by reporter”. Acknowledgement attachment is evidence provided by the reporter, not independent verification. For phase-one sample exercises, explicitly distinguish simulated records from genuine external actions; the app never invents an actual send. Public anonymous attribution does not hide identity from external recipients.

## 8. My reports and private timeline — `/pilot/reports`, `/pilot/reports/:id`

List: product/brand, updated date, preparation badge, community visibility badge, personal status. Empty state offers Raise a concern. Selecting a record opens:

```text
Product / Brand                              [Edit report]
Private demo record · sample/redacted only
Preparation: Draft/Ready  Community: Private/Pending/Published/etc.
Personal follow-up: Open/Closed by reporter
[Prepare complaint] [Preview community version / Manage sharing]

Brand actions                               [Record submission]
[Submission date, acknowledgement attached indicator]
[Add response] [Record follow-up]
Official actions                            [Record submission]
[Independent submission records and responses]

Timeline: saved → review requested → published → recorded actions
[Close my complaint] / [Reopen my complaint]
```

Timeline distinguishes internal publication events from reporter-recorded external events and displays event dates. Personal attachment previews remain outside community payloads. Manual follow-up form records channel/date/note without scheduling. No reminder dates, settings, or notifications. Close dialog requires a reason and says closure does not establish safety, fix the label, or remove the community report. Reopen appends an event. No generic Resolved badge. Failed writes remain on screen with retry; unknown records do not expose another scope's data.

## 9. Response entry and response sharing — modal from submission

```text
Record a response
For: [selected brand/official submission]
Sender [____]  Response date [____]
Summary [________________________________]
Optional supporting screenshot/document [Upload]
This response stays private unless you separately request sharing.
[Cancel]                                 [Save private response]
```

Sender, date, summary required; attachments optional and constrained by technical file rules. Save appends to the selected submission and leaves personal closure unchanged. After success offer “Preview response for sharing”; do not preselect or auto-submit. Preview contains redacted summary and explicitly selected assets, unchecked consent, then “Request response review”. Reviewer approval exposes only this snapshot. A pending response revision cannot leak into detail or replace an approved version. Display “Recorded by reporter”, with “Supporting attachment provided” where applicable. Reviewed evidence of a label change may be described factually; do not turn it into a safety claim.

## 10. Reviewer queue and detail — `/pilot/review`, `/pilot/review/:requestId`

```text
Review queue                           Demo reviewer
[Pending reports] [Response updates] [Correction requests]
Product · request type · requested date                [Review]

Review detail
Proposed community version       Private source evidence (review only)
Evidence checklist: identity / claim / ingredients / explanation
Privacy and factual wording checklist
[Reason / requested correction ______________________]
[Approve publication] [Request changes] [Reject]
```

Reviewer is the product owner; displayed role is simulated in phase one. Approval shows precisely the snapshot being published. Approve requires completeness and privacy checks; changes/rejection require a reason. Prevent duplicate decisions; stale revision returns “This request changed. Reload before reviewing”. Failed approval leaves queue item pending. Response review uses the same model with selected response evidence. Reviewer cannot silently approve a different edited payload: return changes to reporter for consent.

Correction queue opens the published version and request reason. Actions: keep visible and record review reason, or remove from community with a required reason. Removal preserves private records and history. No destruction of source evidence through moderation UI. Empty queue says “Nothing waiting for review”. Public detail may show a documented label change only if reviewed supporting evidence justifies that precise update; no generic verified/safe badge.

## Cross-screen acceptance check

A tester must be able to explain: (1) saving is private, (2) publication needs review and is independent of filing, (3) external sending occurs outside FoodProof, (4) action/response records are reporter supplied, (5) demo roles do not provide real account security. Test at least one complete create → share → review → feed flow and one draft → handoff → record submission → private response → reviewed response flow, plus withdrawal, failed upload, failed save, and empty search. Validate public home never loads pilot content. Test keyboard navigation and a 360 px viewport. Do not include real allegations or original community-report evidence without permission and review.
