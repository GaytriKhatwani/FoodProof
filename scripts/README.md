# Operator scripts

Server-side operator scripts run by the integration owner against the **dedicated
demo** Supabase project. Owned by ticket T1 (see `docs/FOODPROOF_BUILD_TICKETS.md`).
Run each with Node's built-in env-file loader so no secret is hard-coded:

```bash
node --env-file=.env.local scripts/<script>.mjs
```

Implemented (T1):

- **`setup-storage.mjs`** — create the private `demo-originals` and `demo-reviewed`
  buckets. Idempotent; existing buckets are left as-is.
- **`create-invitations.mjs`** — generate high-entropy user/reviewer invitation
  codes, storing only SHA-256 hashes in `demo_access`. Raw codes print once for
  private distribution and are never written to a file, committed, or logged.
  Options: `--users <n>` (default 2), `--days <n>` (expiry, default 7),
  `--no-reviewer`.
- **`seed.mjs`** — create the fictional published pilot example and its simulated
  response through the same application API and publication services a reporter
  uses (never raw inserts), plus a second unreported product as an unpublished
  draft (`docs/FOODPROOF_TECHNICAL_SPEC.md` §5a, decision D25). Uploads the real
  fictional label photograph (`design/assets/clear-signal-label-preview.jpg`,
  always labelled fictional/illustrative), not a stub image. Requires the app
  running (`npm run dev`). Idempotent: exits if the example is already published.
  Option `--reset`: before seeding, deletes ONLY the rows (and Storage objects in
  both private buckets) owned by demo_access rows labelled exactly
  `seed@foodproof` or `seed-reviewer@foodproof` — the same child→parent table
  order as `teardown.mjs`, scoped to just those two labels. It never touches any
  other invitation. Use it to replace an already-seeded example, e.g. after a
  fixture fix. Prints row/object counts only, never ids or codes.
- **`teardown.mjs`** — delete demo database records (every table in child→parent
  order) and both storage buckets' objects. DRY-RUN by default; to delete you must
  pass **both** `--confirm` and `--project <ref>` matching this project's ref
  (`docs/FOODPROOF_SETUP_AND_OPERATIONS.md`). Never run against production.

Withdrawal hides community content and preserves private history; it is not
deletion. Deleting demo data is a deliberate operator action via `teardown.mjs`.

Added at T4:

- **`analytics-journey.mjs`** — with the app running, creates a temporary invitation,
  enters the pilot through the public API, allows analytics consent and drives one
  consented reporter journey (create → upload the fictional label → confirm facts →
  save a template draft → record a submission → request publication), then a
  declined-consent journey and a withdrawn-mid-way journey, printing ONLY the expected
  event names, their `$insert_id`s and the session's `analytics_actor_id` for
  comparison in Mixpanel Live View. Deletes everything it created. Prints no codes,
  tokens or content.
