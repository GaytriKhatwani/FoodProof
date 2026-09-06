# FoodProof — UI audit and polish pass

Scope: every rendered surface of the phase-one invited demo — public home, invitation
entry and analytics consent, the reporter journey (editor steps, evidence, facts
confirmation, actions/draft with the AI disclosure and assisted panels, community
sharing, private timeline), the community feed, concern detail and correction flag,
the reviewer queue, review detail and moderation, plus the shared loading, empty and
failure states. Checked at 1280 px and 360 px, keyboard-only, and against
`prefers-reduced-motion`.

Method: read every component and stylesheet under `app/` and `components/`, computed
the contrast ratio of every token pair actually used, measured layout and touch
targets in a real browser at 360 px, and captured full-page screenshots of every
screen at both widths against a live demo session.

This branch was merged with `main` after the audit (feed-card thumbnails, accessible
upload progress, the AI EXIF-strip fix) and every check below was re-run on the merged
tree. Both incoming changes sit alongside these fixes rather than against them: the
upload progress markup is untouched by D2, which only adds a role to the error element
beside it, and the new thumbnail column keeps the search field's corrected border.

Constraints honoured: no API contract, server code or analytics event name or property
was touched; no user-facing string that a test asserts on was changed; the Clear Signal
tokens in `docs/DESIGN.md` were extended, never replaced; no dependency was added; no
safety copy was weakened, softened or removed.

---

## Health score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 / 4 | Interactive control borders failed SC 1.4.11 (1.55:1); several errors were announced but not associated with their field; one client event ignored withdrawn consent |
| 2 | Performance | 4 / 4 | No animation, no layout thrash, no unbounded effects, images sized to avoid shift |
| 3 | Responsive design | 3 / 4 | No sideways scroll anywhere; the wrapped pilot header put navigation visually last while Tab reached it first |
| 4 | Theming | 4 / 4 | Every colour comes from a token in `app/globals.css`; no hard-coded colour outside two hover tints |
| 5 | Implementation integrity | 4 / 4 | Coherent, product-specific, and unmistakably this product; status wording centralised in one module |
| **Total** | | **18 / 20** | Excellent — minor polish |

### Implementation integrity verdict — PASS

This is not a generic dashboard wearing a brand. Status is modelled as three genuinely
separate dimensions (preparation, community visibility, personal follow-up) with their
labels defined once in `components/reporter/ui.tsx` and reused everywhere, so no screen
can invent a fourth meaning. The safety discipline is structural rather than decorative:
`chipTone` treats colour as an accent and never as the message, `ReadinessPanel` renders
the server's `preparation` value instead of deciding readiness itself, and the drafting
screen separates prepare / copy / open / record as four distinct acts. The one drift
found — see A1 — was a token used outside its intended role, not a system failure.

### Executive summary

- **Health score: 18 / 20** (Excellent)
- **Issues found: 21** — P0: 0, P1: 6, P2: 9, P3: 6
- **Fixed in this pass: 16.** Deferred: 5, each with a reason below.
- Top issues: optional analytics still attempted after consent was withdrawn (D1),
  control-border contrast (A1), a silently swallowed pagination failure (A2), focus
  lost on validation while the screen jumped to another step (A3), and a
  visual/keyboard order mismatch in the wrapped pilot header (A8).
- **D1 and D2 came from the deployed acceptance run**, not from this audit; both are
  fixed here with new coverage.

---

## Findings by severity

### P1 — fix before release

#### A1 · Interactive control borders fail WCAG 2.1 SC 1.4.11 — **fixed**

- **Location** `app/globals.css` (`--color-rule`), consumed as a control border in
  `components/reporter/reporter.module.css` (`.input, .textarea, .select`,
  `.stepButton`, `.tab`), `components/shell/EntryForm.module.css` (`.input`),
  `components/community/FeedView.module.css` (`.searchInput`),
  `components/community/FlagForm.module.css` (`.textarea`),
  `components/community/ConcernDetail.module.css` (`.assetButton`),
  `components/review/ReviewDetail.module.css` (`.input`, `.textarea`, `.assetButton`),
  `components/review/ReviewQueue.module.css` (`.textarea`).
- **Category** Accessibility (non-text contrast).
- **Impact** `--color-rule` is `#cbd0d9`: **1.55 : 1** against white and **1.52 : 1**
  against paper. It is a good hairline for a decorative divider and far below the 3:1
  that SC 1.4.11 requires for the boundary of a control a user must find and operate.
  In low light, on a dimmed laptop, or for a reader with reduced contrast sensitivity
  the text fields and the four editor step buttons visually disappear into the page —
  confirmed in the 1280 px screenshots, where the non-current step buttons read as
  floating text.
- **WCAG** 2.1 AA, SC 1.4.11 Non-text Contrast.
- **Fix applied** Added one token, `--color-control-border: #7d8596` (3.71 : 1 on
  white, 3.64 : 1 on paper, 3.12 : 1 on tint), and switched exactly the interactive
  boundaries to it. `--color-rule` keeps every decorative job — section rules, panel
  edges, table separators, fieldset grouping — which the success criterion exempts.
  Disabled controls are also exempt and keep the quieter rule colour, so "disabled"
  still reads as disabled.

#### A2 · "Show older reports" fails silently — **fixed**

- **Location** `components/reporter/MyReportsScreen.tsx`, `loadMore` vs. the
  `status === "failed"` guard around `FailureNotice`.
- **Category** Accessibility / error handling.
- **Impact** `loadMore` set `failure` but left `status` at `"ready"`, and the only
  `FailureNotice` on the screen was gated on `status === "failed"`. A failed
  pagination request therefore produced no message at all: the button un-disabled
  itself and nothing happened. This is the exact "no silent failure" rule the project
  works to everywhere else.
- **Fix applied** A second `FailureNotice` beside the button, shown when the page is
  ready but the last pagination attempt failed, with a retry that re-runs `loadMore`.

#### A3 · Validation moves the screen but not focus — **fixed**

- **Location** `components/reporter/ReportEditorScreen.tsx`, `save()`.
- **Category** Accessibility / cognitive load.
- **Impact** Pressing "Save report and open the record" on step 4 with an empty product
  name jumps the editor back to step 1, marks the field, and prints a second, differently
  worded explanation at the very bottom of a long page — while focus stays on a button
  that no longer exists in the current step. The 1280 px screenshot shows the two
  messages roughly 900 px apart. A keyboard or screen-reader user is left with no
  announcement, no focus, and two competing accounts of one problem. The failure notice
  also offered "Try again", which cannot succeed: the same request would be refused
  identically.
- **WCAG** 2.1 AA, SC 3.3.1 (error identification is met, but the recovery path is not
  reachable); SC 2.4.3 Focus Order.
- **Fix applied** `focusFirstInvalidField` moves the caret to the first field that has
  to change, on both the local validation path and a server-returned field error. The
  retry button is suppressed for `validation` failures — the named fields above are
  the real next step — while `stale`, `unavailable` and the rest keep theirs.

#### A8 · Wrapped pilot header disagrees with the focus order — **fixed**

- **Location** `components/shell/PilotShell.module.css`, `@media (max-width: 900px)`.
- **Category** Accessibility / responsive.
- **Impact** `.nav { order: 3 }` moved the Feed / My reports / Review links visually
  below the analytics controls and Exit demo, while DOM order kept them before those
  controls. A sighted keyboard user tabs into the navigation *before* the controls they
  see above it; a screen-reader user hears a different order from the one on screen.
  Visible at 360 px in the header screenshot.
- **WCAG** 2.1 A, SC 1.3.2 Meaningful Sequence; SC 2.4.3 Focus Order.
- **Fix applied** Removed the reorder. Navigation and the session controls each take
  their own full-width row in DOM order, which also puts the primary navigation back
  above the secondary controls where it belongs.

#### D1 · Optional analytics events are still attempted after consent is withdrawn — **fixed**

Reported from the deployed acceptance run, not found by this audit.

- **Location** `lib/analytics/index.ts` (the client adapter), `lib/client/session.tsx`,
  `components/shell/EntryForm.tsx`.
- **Category** Accessibility / privacy contract.
- **Impact** The client adapter had no consent gate at all: `emit` posted every event
  to `/api/analytics` and relied entirely on the server to refuse it. After
  "Withdraw consent" — with the header correctly reading "Usage analytics: off" —
  visiting `/pilot/feed` still sent `feed_viewed`, and the server answered
  `{"accepted": false}`. Nothing reached Mixpanel, so no data was collected; but the
  browser still reported the participant's navigation to the server on every screen,
  which is not what withdrawal was presented as. Acceptance A14 requires that a
  withdrawn session emits no optional event.
- **Fix applied** A single consent answer recorded in the adapter
  (`setClientAnalyticsConsent`), and `emit` returns before touching the network unless
  that answer is `true`. `SessionProvider` sets it from `me.analytics_consent` on every
  `/api/me` read — which is where a withdrawal already refreshes — and clears it on exit
  or on a lost session. The entry screen sets it directly, both ways, because it lives
  outside the provider. `null` (not yet answered) is treated exactly like a refusal, so
  an unknown permission is never assumed granted; children of the pilot shell do not
  render until `/api/me` has answered, so no consented event is lost to that ordering.
  The server-side refusal is untouched and remains the real enforcement — this is the
  second lock, not a replacement.
- **Coverage added** `tests/e2e/entry-session.spec.ts` — allow consent, prove the feed
  really does emit, withdraw, then navigate and search and assert **zero**
  `/api/analytics` requests. `tests/unit/client-analytics.test.ts` gains cases for
  withdrawn and for not-yet-known consent, and its existing cases now record consent
  explicitly rather than depending on an ungated adapter.

#### D2 · Evidence-upload validation errors are never announced — **fixed**

Reported from the deployed acceptance run, not found by this audit.

- **Location** `components/reporter/EvidenceSection.tsx`, the `localError` span.
- **Category** Accessibility (status messages).
- **Impact** "That file is 4102 KB. The limit is 3 MB…" and "Label photos must be a
  JPEG, PNG or WebP image." rendered in a plain `<span>` linked only by
  `aria-describedby`. The check runs on the client the moment the file dialog closes,
  and nothing else on screen changes, so a screen-reader user got no notification that
  their file had been refused — they would discover it only by navigating back to the
  field. Every other error surface in the pilot uses `role="alert"` or `role="status"`.
- **WCAG** 2.1 AA, SC 4.1.3 Status Messages.
- **Fix applied** `role="alert"` on that one element. No string changed, and the
  surrounding upload markup is untouched — another branch is adding an upload progress
  indicator in the same component.

### P2 — fix in this pass

#### A4 · Moderation errors marked but not named — **fixed**

- **Location** `components/review/ModerationActions.tsx` (remove-reason and
  relink-reason textareas).
- **Category** Accessibility (error association).
- **Impact** Both textareas set `aria-invalid` when their action is refused, but the
  explanation was an unlinked `InlineNote`. A screen reader announced "invalid" with no
  reason attached to the field, and a user who moved away and came back had no way to
  re-read why.
- **Fix applied** Gave `InlineNote` an optional `id` (`components/shell/states.tsx`)
  and pointed each textarea's `aria-describedby` at its own message.

#### A5 · Consent-blocked messages not tied to the consent box — **fixed**

- **Location** `components/reporter/ShareScreen.tsx`,
  `components/reporter/dialogs.tsx` (`ResponseShareDialog`).
- **Category** Accessibility (error association).
- **Impact** "Tick the consent box before sending this for review." was a `role="alert"`
  paragraph only. It is announced once; after that the checkbox it is about carries no
  trace of the refusal, so a user returning to the control gets no explanation.
- **Fix applied** `aria-invalid` plus `aria-describedby` on both consent checkboxes.

#### A6 · `aria-expanded` without `aria-controls` — **fixed**

- **Location** `components/review/ModerationActions.tsx` (moderation toggle),
  `components/review/SnapshotView.tsx` (raw-snapshot toggle).
- **Category** Accessibility.
- **Impact** The button announced an expanded state with no way to say what it expanded,
  and the region it revealed had no id at all. `FlagForm` and `FlagRow` already did this
  correctly, so this was inconsistency rather than ignorance.
- **Fix applied** Gave each region a `useId()` id and wired `aria-controls`.

#### A7 · Disabled "Approve publication" explains nothing — **fixed**

- **Location** `components/review/ReviewDetail.tsx`.
- **Category** Accessibility / cognitive load.
- **Impact** Approve stays disabled until all six checklist items are ticked. The
  sentence that says so sits below the three buttons and was not connected to any of
  them, so a screen-reader user reaching a disabled button was told only "dimmed".
- **Fix applied** `aria-describedby` from the Approve button to that note while the
  condition is unmet. The note was already rendered exactly then.

#### A9 · Feed result count announced unreliably — **fixed**

- **Location** `components/community/FeedView.tsx`.
- **Category** Accessibility (live regions).
- **Impact** The `aria-live="polite"` count lived inside the `status === "ready"`
  branch, so every search destroyed the region and mounted a new one. A live region
  inserted with its content already present is not reliably announced, which loses the
  one thing a screen-reader user needs after pressing Search: how many results came
  back. The 360 px search flow depends entirely on it.
- **Fix applied** The count is now a permanent region rendered in every status, empty
  while loading. It also reserves its own line, so results no longer shift the page up
  when they arrive.

#### A10 · Focus dropped when a block replaces the control that had it — **fixed**

- **Location** `components/community/FlagForm.tsx` (submitted confirmation),
  `components/review/ReviewDetail.tsx` (decision outcome).
- **Category** Accessibility (focus management).
- **Impact** Submitting a correction request removes the whole form including the
  focused submit button; taking a review decision removes the whole decision panel.
  Focus falls to `<body>`, so the next Tab restarts at the top of the page and the
  confirmation the user just earned is never reached by keyboard.
- **Fix applied** An additive, opt-in `focusOnMount` on `StateBlock`
  (`components/shell/states.tsx`), implemented with a callback ref so the module stays
  hook-free — `LoadingBlock` beside it is rendered from a server component
  (`app/pilot/page.tsx`).

#### A11 · Refused invitation code leaves the field looking valid — **fixed**

- **Location** `components/shell/EntryForm.tsx`,
  `components/shell/EntryForm.module.css`.
- **Category** Accessibility / clarity.
- **Impact** A rejected code produced red message text while the input itself kept its
  neutral border and, for a non-`VALIDATION_FAILED` refusal, no `aria-invalid` at all.
  The message and the control it belongs to were connected only by proximity, and
  focus stayed on the submit button rather than on the thing to correct.
- **Fix applied** An `.inputInvalid` border matching the reporter form's convention,
  `aria-invalid` for every refusal, and focus returned to the field — except when the
  backend is unreachable, where the form is replaced by its own state block that must
  keep focus.

#### A12 · Evidence viewer clips its own image at 360 px — **fixed**

- **Location** `components/community/EvidenceViewer.module.css`.
- **Category** Responsive.
- **Impact** `.canvas` used `max-height: calc(92vh - 76px)`, a hard-coded guess at the
  toolbar height. At 360 px the caption and the two buttons wrap onto separate rows and
  the bar is roughly 110 px, so the canvas overflowed a dialog with `overflow: hidden`
  and the bottom of a tall evidence photo was silently cut off — on the exact screen
  where reading the ingredient list is the point.
- **Fix applied** A flex column: the bar is `flex: 0 0 auto`, the canvas is
  `flex: 1 1 auto; min-height: 0`, no magic number. Guarded with `.dialog[open]` so the
  new `display: flex` cannot override the user-agent `display: none` on a closed
  `<dialog>`.

#### B1 · Home page skips a heading level — **fixed**

- **Location** `app/page.tsx`, the Document / Take action / Follow the record block.
- **Category** Accessibility / information architecture.
- **Impact** Three `<h3>` headings followed the page `<h1>` with no `<h2>` between
  them. Heading navigation — the primary way a screen-reader user skims a page — reports
  a level that is not there.
- **Fix applied** Promoted them to `<h2>` and updated the `.pillar h2` selector. No
  visible text and no type size changed: heading *level* is structure, size is emphasis.

#### B2 · Optional, not-yet-entered facts shown in error red — **fixed**

- **Location** `components/reporter/ActionsScreen.tsx`, "What the draft is built from".
- **Category** Clarity / tone.
- **Impact** The checklist marks every absent field "Missing" in `--color-error`,
  including Batch number and Observation date, which the product explicitly treats as
  optional. On a freshly confirmed report the 360 px screenshot shows five red
  "Missing" markers stacked in a column: it reads as five failures on a screen where
  nothing has gone wrong, and it competes with the genuine red caution above it
  ("Do not send these practice messages to a real brand"). Alarm used where nothing is
  wrong makes alarm cheaper where something is.
- **Fix applied** A `.checkNeutral` variant of the same checklist row. The word
  "Missing" is unchanged and still carries the meaning; only the colour drops to
  `--color-muted`. `ReadinessPanel` keeps error red, because a missing item there really
  does block the review request.

### P3 — noted, not fixed

#### C1 · `window.confirm` in three places — **deferred**

- **Location** `components/reporter/EvidenceSection.tsx` (remove a file),
  `components/reporter/ActionsScreen.tsx` (replace text with an assisted draft;
  restart from the template).
- **Impact** The app has a proper accessible dialog (`components/reporter/Modal.tsx`:
  focus trap, Escape, focus restoration, real buttons) and uses it everywhere else.
  A native `confirm()` is accessible but is styled by the browser, cannot carry the
  project's careful wording as structured content, and is the one interruption in the
  flow that does not look like FoodProof.
- **Why deferred** Replacing a blocking browser call with rendered UI changes behaviour
  and adds state to three flows. No e2e test registers a dialog handler, so these
  branches are currently untested in both directions — converting them without adding
  coverage would be trading a known-good primitive for an unproven one. Worth a small
  dedicated ticket with tests.

#### C2 · Review-queue count has the same live-region problem as A9 — **deferred**

- **Location** `components/review/ReviewQueue.tsx`.
- **Why deferred** The component early-returns for loading and error, so keeping the
  region mounted needs the whole render restructured rather than a line moved. Impact
  is much lower than the feed's: this is a reviewer-only screen, "Refresh queue"
  replaces the entire page visibly, and there is no search. Same fix, separate change.

#### C3 · Two `<h2>` scales on one screen — **deferred**

- **Location** `.sectionTitle` (20–27 px) and `.subTitle` (18 px) are both used for
  `<h2>` on `ActionsScreen`, `ShareScreen`, `MyReportsScreen` and `ReadinessPanel`.
- **Impact** "Confirm your label facts first" — a blocking instruction — renders smaller
  than the section headings below it. The level is correct; the visual weight inverts
  the priority.
- **Why deferred** Changing which heading gets which scale is a typographic decision on
  a screen whose hierarchy the owner approved (D22/D23). It is a design call, not a
  defect fix, and this pass was explicitly scoped to polish rather than redesign.

#### C4 · Repeated identical fieldset legends — **deferred**

- **Location** `components/reporter/EvidenceSection.tsx`, the per-photo "Roles for this
  photo" legends and their three identical checkbox labels.
- **Impact** With several photos, a screen reader reads the same three labels N times
  with nothing distinguishing which photo they belong to. Navigating by form control is
  ambiguous.
- **Why deferred** The fix is per-card visually-hidden text, which changes the
  accessible names of controls. "Remove file" is asserted by name in
  `tests/e2e/reporter-editor.spec.ts`; the surrounding names are close enough that this
  wants to be done together with a test update, deliberately.

#### C5 · Correction-request rows do not name their concern — **deferred**

- **Location** `components/review/FlagRow.tsx`, every row titled "Correction request".
- **Impact** A reviewer with several open flags cannot tell them apart without opening
  each published concern in turn.
- **Why deferred** `ReviewQueueFlag` carries no product identity, so this needs an API
  contract change — explicitly out of scope for this pass.

#### C6 · `DESIGN.md` describes motion the build does not have — **observation**

- `docs/DESIGN.md` specifies "a restrained 260ms reveal" on route change and a headline
  underline that "draws once". Neither exists: there is no `@keyframes`, no `transition`
  and no `will-change` anywhere in the codebase. The reduced-motion block in
  `app/globals.css` is therefore correct but currently inert, and it is safe — nothing
  it disables carries state, so no feedback is destroyed. Either the doc or the build is
  ahead of the other; the owner should decide which. **No code change made.**

---

## Patterns and systemic issues

1. **One token doing two jobs.** `--color-rule` was correct as a divider and wrong as a
   control boundary. Splitting it (A1) removes the whole class of failure rather than
   patching nine stylesheets by hand.
2. **Errors are announced but not owned.** Four separate places set `aria-invalid` or
   printed `role="alert"` text without an `aria-describedby` link (A4, A5, A11). The
   pattern already exists and is done well in `TextField`/`TextAreaField`
   (`components/reporter/ui.tsx`) — it simply had not reached the hand-rolled forms.
3. **Focus is not moved when the DOM under it disappears.** Three flows replace the
   focused control with a result block (A3, A10). The `Modal` component already gets
   this exactly right, including focus restoration; the non-modal flows did not.
4. **Live regions mounted with the content they should announce** (A9, C2).

## What is working well — keep doing it

- **Colour is never the message.** Every status pairs a colour with a word, and
  `chipTone` in `components/reporter/ui.tsx` is written so it cannot do otherwise.
- **Text contrast is comfortable everywhere.** Measured: muted-on-paper 7.25 : 1,
  ink-on-paper 18.08 : 1, primary-on-paper 8.01 : 1, error-on-paper 7.10 : 1,
  status-ink-on-tint 8.34 : 1. No text pair is below AA, and most clear AAA.
- **`Modal` is a genuinely correct dialog** — focus in on open, Tab trapped, Escape
  closes, focus restored to the opener on unmount, real `<button>`s throughout.
- **Every touch target measures ≥ 24 px and every control ≥ 44 px** at 360 px; the
  automated sweep found no exception.
- **`prefers-reduced-motion` is honoured and honest.** Nothing animates, so the global
  disable destroys no state change or feedback — the failure mode the criterion exists
  to prevent.
- **Loading states reserve their height**, so arriving content does not shift the page.
- **Failure copy is specific and never lies.** "Nothing was saved", "your text is still
  here", "copying is not sending", "opening a destination is not submission". The
  vocabulary is consistent across every screen.
- **Safety wording is structural, not cosmetic.** Approved / ready / closed are each
  qualified where they appear, and no screen can silently imply filing, delivery or
  safety.

#### C7 · Merged upload progress bar — **checked, no change needed**

`components/reporter/reporter.module.css` `.progressTrack` uses `--color-rule` for its
outer border, which A1 would normally flag. It is correct as it stands: a progress bar
is not operated, and SC 1.4.11 asks that the **state** be perceivable — the filled
`--color-primary` against the `--color-tint` track is 6.87 : 1, comfortably over 3:1.
Left exactly as the branch that added it wrote it.

## Verification

Run on the merged tree (`polish/ui-impeccable` after `git merge main`):

| Check | Result |
|---|---|
| `npm run typecheck` | pass — 0 errors |
| `npm run lint` | pass — 0 warnings, 0 errors |
| `npm run build` | pass — compiled successfully |
| `npm run test:e2e` | **128 passed, 0 failed** (8.0m) — both projects, `desktop` 1280×800 and `mobile` 360×740 |
| `npx vitest run` | **239 passed, 0 failed** across 19 files (live Supabase) |

Baseline before this pass: 126 e2e and 233 vitest. The two extra e2e tests are the
withdrawn-consent assertion running in both projects; the extra vitest tests are the
withdrawn and not-yet-known consent cases plus the two that arrived with `main`.

Both live suites were run holding the shared lock at
`/private/tmp/claude-501/foodproof-live-suite.lock`, released immediately after.

## Open questions for the owner

1. **C6** — should the route-change reveal and the headline underline from
   `docs/DESIGN.md` be built, or should the document record that phase one ships
   without motion? Either is defensible; the mismatch is not.
2. **C3** — "Confirm your label facts first" is a blocking instruction rendered at the
   smaller `.subTitle` scale, below full-size section headings. Promote panel headings
   that block progress, or accept the current scale as approved?
3. **C1** — is converting the three `window.confirm` calls to the project's own dialog
   wanted for the pilot, or is a browser confirm acceptable for destructive demo
   actions?
