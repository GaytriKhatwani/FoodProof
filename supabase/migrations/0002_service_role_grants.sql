-- FoodProof 0002 — service_role table grants (FOODPROOF_TECHNICAL_SPEC.md §3).
--
-- Run this ONCE on a demo project where 0001_init.sql was applied before the
-- grants were folded into it. In this project the default privileges did not
-- grant `service_role` on the public tables that 0001 created, so the server's
-- service role (which bypasses RLS) hit "permission denied" on every table.
--
-- These grants make service_role the sole role with access; anon/authenticated
-- remain revoked (0001). Idempotent and safe to re-run. On a FRESH project that
-- applies the updated 0001, this file is a harmless no-op.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
