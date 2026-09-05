# Operator scripts

Server-side operator scripts run by the integration owner against the **dedicated
demo** Supabase project. Owned by ticket T1 (see `docs/FOODPROOF_BUILD_TICKETS.md`);
this directory is created in T0 so the layout is frozen.

Planned scripts (not implemented in T0):

- **Invitation generation** — create high-entropy user/reviewer invitation codes,
  storing only SHA-256 hashes in `demo_access`. Never print or commit raw codes;
  the owner distributes them privately (`docs/FOODPROOF_TECHNICAL_SPEC.md` §2).
- **Fictional seed data** — create the published pilot example and its simulated
  response through the same application publication services and transactions,
  under a dedicated seed owner, tagged `dataset='demo'`/`'seed'`
  (`docs/FOODPROOF_TECHNICAL_SPEC.md` §5a, decision D25). No raw inserts.
- **Demo teardown** — delete demo records and storage copies with dry-run counts,
  a project-id guard and explicit operator confirmation
  (`docs/FOODPROOF_SETUP_AND_OPERATIONS.md`).
