# FoodProof — Current MVP requirements

Status: team-review baseline after explicit Clear Signal approval. Detailed contracts are linked from FOODPROOF_BUILD_HANDOFF.md. Requirements below consolidate existing decisions; they are not a new research phase.

## Problem and desired outcome

Interview findings supplied by the owner indicate low awareness of official complaint portals, unanswered complaints, brand-email workarounds and reliance on WhatsApp communities. These are qualitative observations, not prevalence estimates. Dharit's report motivates investigation of apparent gluten-free claim/ingredient contradictions; individual allegations are not independently verified by this package.

FoodProof should make evidence easier to preserve, complaints easier to prepare and community concerns easier to understand. Brand accountability is the long-term hypothesis. The invited demo can validate usability and truthful status comprehension, not government responsiveness or health outcomes.

## P0 requirements

| ID | Requirement | Primary contract |
|---|---|---|
| R01 | Public introduction clearly explains independent status and external official filing; no pilot data exposure | Screens 1–2 |
| R02 | Per-tester invitation sessions and owner reviewer invitation; mocked `user@foodproof` / `reviewer@foodproof` labels | Technical 2–3 |
| R03 | Save incomplete private reports and evidence, reopen and edit with recoverable failures | Workflows 3; Screens 5 |
| R04 | Publication needs product/brand, explanation, ready photographs covering identity/claim/ingredients and user-confirmed facts | Technical 4–5 |
| R05 | Optional AI extracts suggestions and drafts only from confirmed facts; manual/template flow always works | Technical 8; API supplement |
| R06 | Editable brand/government drafts, copy and deliberate external handoff; record submissions separately | Screens 7; Workflows 4–5 |
| R07 | Sharing is optional and independent of filing; explicit snapshot preview, consent, moderation, correction and withdrawal | Workflows 6; Technical 5 |
| R08 | Invited feed/search/detail shows only current approved anonymous projections and reviewed responses | Screens 3–4 |
| R09 | Independent report on same product keeps separate evidence/history; no automatic fuzzy merge | Technical 4 |
| R10 | Separate brand/government submissions, manual follow-ups, private responses and separately reviewed response sharing | Screens 8–9 |
| R11 | Reporter closes with reason/reopens; closure never means safe, fixed or officially resolved | Workflows 8 |
| R12 | Product owner reviews immutable snapshots; tester cannot grant role or approve; flags route privately to owner | Screens 10; access matrix |
| R13 | Actual Supabase persistence and private storage; protected server reads/writes | Technical 3–7 |
| R14 | Explicit consent and allowlisted events reach dedicated demo Mixpanel project; no content/PII | Measurement 2–4 |
| R15 | Clear Signal visual system, mobile/keyboard usability, failure/empty/loading states and reduced motion | DESIGN.md; Screens |

The owner will provide an AI provider and budget before T4 (D33), so live extraction and drafting are required for full phase-one acceptance; the manual/template flow stays mandatory and must work during provider failure. No provider or model is named in these documents. Do not call the AI scope complete until live extraction/drafting is verified against the checklist.

## Phase boundary

Phase one uses invited test users, English and synthetic/redacted evidence. Real authentication (all three requested methods), production permissions and public browsing move to phase two before unrestricted launch. Reminders and translations follow that launch. Timing aspirations do not authorize silent cuts.

Excluded: automatic sending/filing/status sync, food safety answers or scores, legal verdicts, likes/comments/followers, brand accounts, comprehensive catalogue/barcode infrastructure, restaurant or medicine reporting, notifications and reminders.

## Completion and learning

An integrated pilot is ready only when the acceptance checklist passes against real demo services. A missing integration is explicitly blocked, not replaced by an unlabelled fixture. Use 3–5 observed invited sessions and the measurement document's thresholds; report assistance and comprehension failures. No measured real-world complaint outcome may be inferred from fictional tasks.
