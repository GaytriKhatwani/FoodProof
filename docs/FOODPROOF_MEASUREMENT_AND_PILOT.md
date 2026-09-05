# FoodProof — Measurement and invited demo pilot

Status: Build contract, 5 September 2026. Product authority: FOODPROOF_DECISIONS.md, especially D16–D19. Read with workflows and the technical specification. The operational defaults below implement the agreed scope; they are not evidence of user or brand outcomes.

## 1. Release and measurement boundary

Phase one is a publicly accessible introduction plus a restricted, invited demonstration with mocked reporter and reviewer identities. The product owner moderates. Supabase persistence and actual Mixpanel ingestion are required to call those integrations working. No real OTP, Google sign-in, role-based account protection, reminders, or translations are claimed.

Use fictional sample products and synthetic/redacted evidence. Do not use an actual brand allegation from the reference report as seed content without permission and verification. A pilot tester must understand that role labels are simulated, identity is simulated while private evidence is separated by the server-resolved invitation owner, and external actions in the exercise are simulated. Pilot entry protection is defined in the technical specification; a role selector is not protection.

Phase-one findings can establish usability, status comprehension, persistence, and event capture. They cannot establish real complaint conversion, government response rates, brand accountability, clinical safety, or retention. Call all phase-one analytics `demo`; distinguish developer QA from invited testers within that mode.

## 2. Analytics privacy, consent, and identity

Implementation default: no optional analytics until explicit consent. Pilot entry offers “Allow usage analytics” and “Continue without analytics,” with equal access to the experience. Explain that FoodProof records interaction events to improve the demo, not report contents. Provide a persistent settings control to withdraw consent; stop subsequent collection and clear the analytics identifier when withdrawn. Public-home analytics use the same opt-in rule and need not be collected for pilot acceptance.

Never send names, email/phone details, health information, report/complaint text, ingredient text, photographs, file URLs, recipients, reference numbers, search text, closure reasons, free-text errors, or AI prompts/outputs to Mixpanel. Disable automatic interaction capture and session replay for this phase. Send only the explicit allowlisted properties below. Do not attach URL query strings or user-agent-derived custom fingerprints. Any service-controlled metadata must be reviewed in actual ingestion before inviting testers. The invitation limiter's `address_hmac` (FOODPROOF_TECHNICAL_SPEC.md §2/§4) is short-lived pseudonymous security metadata used only for abuse limiting; it is never sent to analytics or used for profiling, the raw originating address is never stored, and expired records are deleted.

Identity rules:

- After consent, generate a random `analytics_actor_id` for this browser's demo session. It is not a verified user ID. Do not identify all reporters as `user@foodproof` or all reviewers as `reviewer@foodproof`.
- Use a random `session_id`; keep it stable across reloads in the current demo session. Demo exit/reset starts fresh IDs. Role changes require exit and a new invitation session; they start fresh analytics IDs. Never accept a client-selected role as authority.
- `actor_role` is `visitor`, `reporter`, or `reviewer`; it is analytical context, not authorization.
- Reviewer's actions must not appear in the reporter funnel. QA, synthetic seeds, and invited tester activity must be separable. Never turn seed creation into human interaction events.
- Public visitor sessions and demo entry need not be merged into an identified profile. Do not create contact-based analytics profiles.
- Phase two must define authenticated pseudonymous identity and account linking separately. Do not merge today's demo identities into production users.

Use a dedicated nonproduction Mixpanel project for demo activity and a separate production project for phase two. Required event properties are a second separation control, not a substitute for separate projects. Environment configuration must never silently send demo traffic to production. Supabase remains the source of persisted facts; Mixpanel is not the audit log.

## 3. Shared event envelope and delivery rules

Every collected event includes:

| Property | Contract |
|---|---|
| `event_id` | Random stable UUID for one logical event; reuse for delivery retries. |
| `occurred_at` | UTC time of the successful action or qualifying view. |
| `analytics_actor_id`, `session_id` | Random identifiers under the identity rules above. |
| `analytics_mode` | Constant `demo` in phase one. |
| `audience` | `qa` or `invited_pilot`, set by deployment/test session configuration. |
| `actor_role` | `visitor`, `reporter`, `reviewer`. |
| `app_version` | Build identifier; no branch description or local path. |
| `schema_version` | Constant `1` for this event contract. |

Entity identifiers are opaque IDs, never product names or user-entered labels. Event-specific properties not listed below are forbidden until this contract is updated. `channel` means `brand` or `government`. `source` and other enumerations are specified per event.

Persisted-action events fire after the operation succeeds, not on click. The UI has one analytics emission owner per action: do not emit the same success from a component, data hook, and server simultaneously. Retrying a save uses the same logical operation identifier; duplicate responses must not emit a second success. A later intentional edit is a new revision and may be measured separately. Analytics failure must never fail or roll back a report save. Best-effort delivery is sufficient; do not add a durable analytics job system for this MVP. Counts may be incomplete and must be compared with persisted demo records during QA.

For page/view events, emit once per successful route entry and entity, after content renders; component rerenders do not count again. An intentional later visit may count again. Funnel calculations use distinct report/session IDs, not raw view counts.

## 4. Event dictionary

The properties in this table are additional to the shared envelope. Required identifiers refer to the shared technical contract; names should be mapped explicitly in the analytics adapter if database names differ.

| Event | Exact trigger | Additional properties | Deduplication unit |
|---|---|---|---|
| `demo_entered` | Consented participant successfully enters a demo role. | `entry_role`: reporter/reviewer | Session + role entry action |
| `feed_viewed` | Feed loads successfully, including a valid empty list. | `result_count` (integer) | Route entry |
| `feed_search_completed` | A user-submitted search returns successfully. | `result_count` only; no query text | Search action |
| `feed_report_viewed` | Approved concern detail renders successfully. | `report_id`, `publication_revision_id`, `source`: feed/search/direct | Route entry + revision |
| `report_started` | First editable new-report screen is shown following an explicit create action; resumed drafts excluded. | `flow_id` (random UUID), `source`: feed/detail/my_reports; `linked_product`: boolean | New flow ID |
| `report_saved` | Draft is persisted successfully, first save or later manual save. | `flow_id`, `report_id`, `is_first_save`: boolean, `evidence_complete`: boolean | Save operation |
| `evidence_uploaded` | File and evidence metadata are both persisted successfully. | `report_id`, `evidence_id`, `purpose`: label/acknowledgement/response | Evidence ID |
| `facts_confirmed` | Reporter explicitly confirms/edits extracted or manually entered facts and saves them. | `report_id`, `method`: manual/assisted | Confirmation operation |
| `complaint_draft_saved` | Editable action draft is successfully saved. | `report_id`, `draft_id`, `channel`, `method`: template/assisted | Save operation |
| `complaint_text_copied` | Clipboard write succeeds. | `report_id`, `channel` | Copy action |
| `official_channel_opened` | Browser handoff is initiated to a configured official destination; does not verify that destination loaded. | `report_id`, `destination_key` (allowlisted configuration key) | Handoff action |
| `brand_email_opened` | Email-composer handoff is initiated; does not verify client availability or delivery. | `report_id` | Handoff action |
| `submission_recorded` | Reporter successfully saves an external submission record; demo instructions specify fictional values. | `report_id`, `submission_id`, `channel`, `has_acknowledgement`: boolean, `provenance`: user_recorded | Submission ID |
| `followup_recorded` | Reporter successfully saves a manual follow-up action. | `report_id`, `submission_id`, `followup_id`, `channel` | Follow-up ID |
| `publication_requested` | Consented snapshot with all required evidence is saved for review. | `report_id`, `publication_revision_id`, `content_kind`: concern/response | Submitted revision |
| `moderation_decided` | Reviewer decision and reason where required are saved. | `report_id`, `publication_revision_id`, `decision`: approved/changes_requested/rejected/removed, `content_kind`: concern/response | Decision operation |
| `report_published` | Approved concern snapshot becomes feed-visible in the invited demo. | `report_id`, `publication_revision_id` | Published revision |
| `publication_withdrawn` | Owner withdrawal succeeds and removes feed visibility. | `report_id`, `publication_revision_id` | Withdrawal operation |
| `response_added` | Reporter successfully saves a private response. | `report_id`, `submission_id`, `response_id`, `channel`, `has_attachment`: boolean | Response ID |
| `report_closed` | Closed-by-reporter state and required reason persist. | `report_id` | Transition operation |
| `report_reopened` | Closed report successfully transitions to open. | `report_id` | Transition operation |
| `flow_error_shown` | A blocking operation failure is displayed to the participant. | `operation`: load/save/upload/prepare_draft/handoff/publish/moderate; `error_code`: network/validation/unavailable/unknown | Failed operation; no rerender duplicates |

Emit `report_published` from the successful approval action only after visibility is committed, not every time a reader sees the report. The actor for this event is the reviewer: connect it to the report using `report_id`, not the reviewer’s analytics identity. Consent of that actor governs collection; operational publication still proceeds without consent. Response publication uses `moderation_decided` with `content_kind=response`, not a new concern publication event.

If AI is implemented, the existing `method` values distinguish it from manual/template paths. No AI invocation volume metric is required for P0. A simulated draft must use `template`, never `assisted`.

## 5. Initial reports and denominators

Filter every report to `analytics_mode=demo`, `audience=invited_pilot`, and the stated build/date window. Exclude reviewer sessions from reporter completion. Use consented sessions only, disclose that limitation, and supplement with observed session notes.

| Measure | Definition | Interpretation |
|---|---|---|
| First-save completion | Distinct `flow_id` with first `report_saved` / distinct `flow_id` started during observed task window | Can people create a persisted report? |
| Publication-request completion | Distinct reports with `publication_requested` / reports assigned the sharing task | Can people submit the evidence/consent flow? |
| Moderation passage | Approved concern revisions / reviewed concern revisions | Review usability/fixture suitability, not truth verification. |
| Handoff progression | Distinct reports with handoff event / reports with saved action draft | Navigation initiated, never actual complaint delivery. |
| Recorded submission task | Distinct reports with `submission_recorded` / reports assigned that task | Ability to record a fictional action; not complaint conversion. |
| Time to usable draft | Observed task start to participant-approved draft, with assistance noted | Report median and range; small samples are descriptive. |
| Feed comprehension | Participants who find concern and correctly explain evidence/status / participants assigned task | Views alone do not establish usefulness. |

Publication spans reporter and reviewer actors. Join by report/revision in a report-level analysis or compare persisted counts; do not use a person-level funnel that requires the same person to create and moderate a report.

## 6. Same-day pilot plan

Implementation default: three to five invited participants, approximately 20–30 minutes each, with the product owner facilitating/moderating. This is a usability demonstration using fictional sample evidence; it does not restart discovery. Record task results in a simple private note sheet using participant codes, no health histories. Screen recording requires separate explicit permission and is not necessary.

Prepare two fictional products: one published example with a clearly marked simulated response and one unreported example with readable identity, claim, and ingredient photos. Create the published example through the seed script in FOODPROOF_TECHNICAL_SPEC.md §5a, which uses the application's own publication services rather than raw inserts. Include an incomplete evidence example for the validation task. Make all sample labels visibly fictional. Do not ask testers to send sample accusations to real brands or government channels.

Read the demo/data boundary and analytics choice first. Ask participants to perform tasks, offering help only after recording where they stop:

1. **Understand the homepage:** “Explain what FoodProof does, and where an official complaint would be filed.” Record whether they distinguish FoodProof from a government portal.
2. **Read the feed:** “Find this sample product and tell me what is known, what is alleged, and whether a complaint or response is recorded.” Probe whether absence of reports means safety.
3. **Create a report:** “Use these supplied photos to document the second product concern; save it, leave, and find it again.” Observe evidence-role selection, save confidence, and recovery.
4. **Share deliberately:** “Keep it private first. Now preview what others would see and request publication.” Confirm no external filing prerequisite and no accidental exposure.
5. **Review:** Product owner requests a correction, reporter resubmits, owner approves. Confirm the right snapshot appears and any unapproved edit stays out of the feed.
6. **Prepare and track:** “Prepare a brand message. Stop before sending. Record the supplied fictional submission and response.” Explain that testing a handoff never requires sending anything. Confirm separate government history and response privacy.
7. **Close and reopen:** “Stop pursuing this report, then resume it.” Ask whether closure establishes safety or fixes the label.
8. **Withdraw:** “Remove your published concern from the feed.” Confirm the private demo record remains and the feed no longer shows it.

For each task record unassisted / assisted / not completed, time, observed failure, and a short interpretation. Separate navigation/usability problems from inability to see value. Do not substitute “Do you like it?” for observed completion.

## 7. Release acceptance and pilot decision

### Before inviting anyone

- Public landing works without demo access and reveals no pilot reports, evidence, or response data.
- Restricted pilot entry follows the technical contract. UI states plainly identify simulated identities; sample/redacted-only guidance is visible.
- Save/reopen and uploads actually persist in Supabase; no browser-only fallback is described as integrated persistence. Server secrets are absent from client assets.
- Publication consent, incomplete-evidence blocking, correction/resubmission, approval, response privacy, withdrawal, and close/reopen work through the complete demo journey.
- Opening an external channel never creates a submission record. Fixture responses never appear as real-world activity. No reminder or translation UI is required.
- Consented QA event sequence is visible in the dedicated Mixpanel project with correct envelope and IDs; inspect actual properties for accidental personal data. A declined-consent session emits none of the optional events. Reloads/retries do not double-count logical saves.
- Reporter and reviewer histories have correct actor roles and can be separated. Test approved publication via report IDs across their sessions.
- On a narrow mobile viewport, all primary actions, evidence previews, form errors, and review controls are usable. Upload/save failures are recoverable.

A broken boundary, data exposure, lost report, false submission status, or fabricated live integration blocks the invited demo until corrected. A missing Supabase or Mixpanel configuration is a named integration blocker; a UI-only preview may be shown as such but does not pass integrated-demo acceptance.

### After the first sessions

Default iteration threshold: at least 80% of participants complete reporting and publication request without facilitator action; all participants correctly understand that publishing/opening a portal does not file a complaint and closure does not certify safety. With three participants, 80% means all three. Treat these as practical readiness checks, not statistical evidence.

If users fail these checks, fix the specific flow or copy and rerun the affected tasks with fresh participants where possible. Keep a list of severe, moderate, and minor findings with the next build version that addresses them. Do not infer brand impact from these sessions.

Passing the demo does not approve unrestricted public launch. Phase two requires real email OTP, phone OTP, Google sign-in, server/database/storage role enforcement, actual private-data isolation tests, production analytics separation, and review of public content before launch. Reminders and translations come after that public-launch readiness work.
