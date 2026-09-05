# FoodProof — Product brief

Status: Agreed product direction; foundation for build specifications.
Last updated: 5 September 2026.

Approved implementation decisions are maintained in [FOODPROOF_DECISIONS.md](FOODPROOF_DECISIONS.md). Current decisions: users send externally using prepared drafts; the product owner moderates through a simple admin screen; public contributors are anonymous. Phase one uses explicitly mocked test identities; real sign-in and role enforcement move to phase two before public launch.

Publication requires photos showing product identity, a gluten-free claim, and the ingredient list, plus an explanation; receipts and batch numbers are optional, and incomplete private drafts are allowed. Reviewed reports may be published before external submission, with the absence of a recorded submission clearly stated. Phase one restricts the feed and reporting to invitation-gated demo sessions. Anonymous public browsing and real sign-in for contributions are phase-two behaviour.

## 1. Purpose of this document

Give the designer, product owner, and coding agent one shared definition of FoodProof: who it serves, why it exists, what the MVP must accomplish, and what it must not imply or do.

Basic research and user interviews are complete. We are entering the build stage. Do not restart discovery or reopen settled product decisions without a concrete reason. This brief is not yet a screen specification, database schema, or implementation prompt.

## 2. Vision

Give India's celiac community a collective voice to make gluten-related food labelling concerns visible, actionable, and traceable, and encourage brands to take those concerns seriously.

FoodProof should turn scattered individual experiences into a credible public record supported by evidence, with clear paths to contact brands, raise official complaints, and record what happens next.

## 3. Product definition

FoodProof is a community reporting and follow-up application, primarily for people with celiac disease in India. Users document suspected gluten-related labelling issues, choose whether to share a reviewed summary publicly, take action through brand and official complaint channels, and track responses.

The community feed is a core part of the product. It makes documented concerns and subsequent responses discoverable around products. It is not a general social feed or a product safety certification service.

## 4. Users and context

Primary users: people with celiac disease in India and caregivers managing food choices for them.

Primary roles:

- Reporter: documents an encountered concern and seeks action or clarification.
- Community reader: looks for reported concerns and responses about a product.
- Moderator/operator: reviews proposed public summaries and evidence for publication, redaction, and corrections.

Brands and government authorities are recipients of action, not required account holders in the MVP.

Initial scope: packaged-food products with suspected gluten-related labelling issues, including an apparent contradiction between a gluten-free claim and the ingredients shown on the label.

## 5. Research basis and remaining hypotheses

### Findings supplied by the product owner

- Some interviewees do not raise complaints through official portals because they do not know those channels exist.
- Some report submitting complaints but not hearing back.
- People contact brands by email and wait for responses.
- People ask WhatsApp communities whether products are safe.
- The product owner identifies Dharit Maniar's community report as supporting evidence, including examples of products making gluten-free claims while listing gluten ingredients.

These are qualitative findings supplied from completed research. They are not prevalence estimates. The report's individual examples must be checked against their source evidence before being used as public product content. This brief does not independently verify each example or establish a regulatory violation.

### Product hypotheses to test through the MVP

- A guided reporting flow helps users produce clearer, more complete complaints.
- A shared, evidence-based public record gives the community more visibility than isolated messages.
- Visible concerns and documented follow-ups encourage brand engagement.
- Readers find value in seeing the evidence and response history for a product.

Brand responses, government action, and changes to labels are desired outcomes, not guaranteed product capabilities.

## 6. Core user jobs

1. When I encounter a concerning label, help me document exactly what I saw without losing the evidence.
2. Help me understand where to take the concern and prepare a factual message or complaint.
3. Help me keep track of what I sent, whom I contacted, and what response I received.
4. Let me make my concern visible to others without exposing my private information.
5. When looking up a product, help me understand what others reported and what happened afterward.

## 7. MVP scope

### P0: complete first release

- A public introduction page explaining the product, its relationship to official portals, and pilot entry.
- Demo user and reviewer experiences with saved sample/redacted reports for phase one; no claim of secure account isolation through simulated roles.
- Email OTP, phone OTP, Google sign-in, and real role enforcement are deferred to phase two before public launch.
- Report creation with product and brand details, label photographs, and a description of the concern.
- Evidence review and correction before taking action or publishing.
- Editable factual complaint or brand-message preparation.
- Clear handoff to the relevant official complaint channel; user-controlled brand contact.
- Recording separate brand and official submission details, including reference numbers where available.
- A report timeline for follow-ups and responses, with the source of each update identified.
- Manually added responses with sender, date, summary, and optional supporting attachment; private unless separately requested and reviewed for publication.
- Reporter-controlled closure with a reason and reopening; closure does not establish resolution or product safety.
- Explicit opt-in to public sharing, a preview of the public summary, and manual moderation before publication.
- A product-focused community feed with basic product/brand search, concern details, dates, and recorded responses.
- A structured way to add an independent report about an existing product, preserving its own evidence and history.
- Supabase database and private evidence storage, with actual Mixpanel events for the core journey. Supabase Auth is phase two.

Build these in successive working slices, not in one large implementation request. Simple manual operations are acceptable for the pilot.

### AI boundary

Initial assistive uses are label-text extraction for user confirmation and drafting from confirmed facts. Build a working manual reporting path first; introduce these aids after the underlying flow works.

AI output must be editable. Missing or unreadable information remains missing; extraction must not silently become confirmed evidence. AI failure must not prevent a user from completing a report manually.

### Outside the first release

- Automatic government filing or synchronized government status without a verified, supported integration.
- Guaranteed brand responses, government action, or complaint resolution.
- Personalized answers to whether a product is safe to eat, safety scores, or certification.
- Automated declarations that a label violates the law.
- General discussion, comments, likes, follower systems, or engagement rankings.
- All follow-up reminders, including in-app dates and reminders, email, and push notifications; consider these after the MVP.
- Brand or government account portals.
- Restaurants, medicines, or all categories of food-safety complaints.
- A comprehensive product catalogue, barcode infrastructure, or complex backend services.

## 8. Core journey

Encounter a concern → identify the product → add evidence → review confirmed facts → save the report → choose action and sharing options → contact the brand and/or use an official channel → record submission and responses.

Public sharing is an optional branch: preview a redacted summary → consent → moderation → publication.

Community journey: browse or search → open a product concern → inspect evidence and response history → optionally create a separate report linked to the same product.

Users must be able to keep a report private. Public sharing must not be a prerequisite for complaint preparation or tracking.

## 9. Product guardrails

### Evidence and credibility

- Describe a concern precisely, including the claim and ingredient text where available, rather than turning a report into a verdict.
- Distinguish original evidence, user statements, AI suggestions, and externally received responses.
- Publication review checks evidence, privacy, and presentation; it does not certify safety or establish a regulatory finding.
- One report does not establish that every batch or variant has the same issue. Retain variant, batch, and observation-date information when available.
- Absence of reports does not mean a product is safe.
- Multiple reports represent multiple recorded experiences, not automatic proof of a violation.
- Public use of material from the community report requires appropriate permission and review; do not seed real allegations automatically from a reference document.

### Honest action and status

- Saving or publishing inside FoodProof is not equivalent to sending an email or filing an official complaint.
- Keep report preparation, external action, and public visibility as separate state dimensions.
- Track brand and government actions separately; one can receive a response while the other does not.
- Label user-reported submissions and responses with their provenance. An uploaded acknowledgement is supporting evidence, not automatic independent verification.
- Use language such as “No response recorded” where FoodProof cannot know whether a response occurred elsewhere.
- A response is not necessarily a resolution. Use “Closed by reporter” with a reason and reopening; never infer safety or an externally verified fix.
- Do not invent timelines or progress indicators suggesting an authority is actively processing a report.

### Privacy and public participation

- Original evidence is private by default. Public summaries and approved assets must be explicitly selected and reviewed.
- Do not expose reporter contact details, private correspondence details, addresses, or unrelated personal information in the feed.
- Provide a way to request correction, flag a report, or withdraw public sharing; define the operating process before the pilot.
- Preserve attribution and context when publishing brand or authority responses, and redact private details.
- Keep public language factual. Do not encourage harassment, pile-ons, or repeat messages as a pressure tactic.

### UX and implementation

- Prioritize a mobile-friendly experience and the reporting journey over a generic dashboard.
- Make the next action, its destination, and its effect explicit.
- Cover draft recovery, upload failure, unreadable images, AI failure, authentication expiry, and empty histories.
- Keep secret keys and privileged operations on the server. In phase one, deny direct database/storage client access and enforce demo-session ownership in server handlers. Production Auth/RLS role policies are phase two.
- Verify that one user cannot read or alter another user's private report or evidence.
- Prefer one application and a small data model. Add infrastructure only when a concrete requirement demands it.

## 10. Measurement

Evaluate useful action and credible participation, not just registrations or feed views.

Initial measures:

- Report completion: started reports that become saved, reviewed reports.
- Action progression: reviewed reports that lead to recorded external submissions, distinguishing self-reported submissions from those with acknowledgements attached.
- Community contribution: consented reports published after review.
- Follow-up: submissions with subsequent updates or responses recorded, measured over a stated time window.
- Usability: time and assistance needed to complete the main journey.
- Feed usefulness: observed ability to find and correctly interpret a product concern; views alone do not prove value.

Candidate events: `report_started`, `evidence_uploaded`, `report_saved`, `complaint_draft_saved`, `official_channel_opened`, `submission_recorded`, `publication_requested`, `report_published`, `feed_report_viewed`, and `response_added`.

Define the exact trigger, actor, properties, and deduplication rule for each event before implementation. Successful save/upload events fire on success, not button clicks. Opening an external channel is not a submission event.

Use pseudonymous IDs. Do not send complaint text, photos, contact details, or health information to Mixpanel. Separate test activity from pilot data. Supabase is the operational record; analytics is a measurement layer.

Set pilot targets before launch. Small qualitative samples and short pilots cannot establish population-level impact or long-term brand behaviour.

## 11. Resolved contracts and remaining setup

Report fields, product matching, status transitions, moderation ownership, sharing rules, demo entry, analytics and pilot tests are now specified in the workflow, technical, screen and measurement documents. Clear Signal is approved. Do not reopen these decisions from this historical brief.

Remaining configuration and limited engineering decisions are tracked in FOODPROOF_SETUP_AND_OPERATIONS.md and FOODPROOF_REVIEW_REPORT.md. They include service credentials, hosting, AI provider and official-link verification. Retention defaults for the synthetic demo are documented separately; production privacy decisions remain a phase-two gate.

## 12. Build order

The original same-day target was an aspiration, not evidence of completion. Team review now precedes implementation. Use FOODPROOF_BUILD_TICKETS.md: establish shared contracts, persist and reopen a private report, add evidence, complete consent/moderation/feed, add action and response history, then integrate AI and verify actual analytics. Complete each slice before calling it working.

## 13. Working agreement for coding agents

- Read this brief and the current build specification before changing the app.
- Use the same repository and decision log across tools; do not rely on copied conversation fragments as the source of truth.
- Do not silently change product intent or add features to fill unspecified details.
- Record material decisions and update the relevant specification when scope changes.
- Implement one bounded slice at a time and report what works, how it was verified, and what remains incomplete.
- Never represent mocked integrations, seeded content, or simulated responses as live activity.
- Keep synced source materials read-only.

## 14. Current decision snapshot

- **Known:** completed interviews indicate low awareness of complaint portals, missing responses, brand-email workarounds, and reliance on community conversations.
- **Agreed:** FoodProof combines evidence-backed reporting, a core public feed, action support, and follow-up; Supabase and Mixpanel are part of the build.
- **Assumed:** shared visibility and organized evidence will improve participation and encourage brand engagement.
- **Uncertain:** the magnitude of that effect, external response behaviour, and which integrations are actually available.
- **Next decision:** team accepts the handoff and assigns the integration owner.
- **Fastest way forward:** build T0 and the private-save/reopen slice against the documented contracts.
