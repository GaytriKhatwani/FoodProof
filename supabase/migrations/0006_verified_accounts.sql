-- FoodProof 0006 — verified accounts (phase two, C.1 server slice)
-- (FOODPROOF_TECHNICAL_SPEC.md §2 "Phase two C.1", FOODPROOF_API_DETAILS.md,
-- docs/FOODPROOF_DECISIONS.md D18.)
--
-- WHY.
--   Phase one identified every actor by an invitation code: `demo_access` held a
--   SHA-256 `token_hash` and nothing else. D18 moves real sign-in to phase two.
--   This migration lets the SAME actor table also hold accounts proved by a
--   verified email address, without changing a single existing row and without
--   changing any foreign key that points at `demo_access`.
--
-- SIDE-BY-SIDE MODEL.
--   An actor row is now EITHER an invitation actor (`token_hash` set,
--   `auth_user_id` null) OR a verified actor (`auth_user_id` set, `token_hash`
--   null). The `demo_access_identity_ck` constraint below makes "exactly one of
--   the two" a database rule, not a convention, so no row can ever be both or
--   neither. Invitation entry is unchanged and keeps working exactly as before;
--   email sign-in is an ADDITIONAL path behind the `EMAIL_SIGN_IN` flag.
--   Removing demo mode is a later ticket, not this one.
--
-- NO-CLAIM RULE.
--   A verified account NEVER inherits, adopts or merges an invitation actor's
--   reports, evidence, drafts or publications (FOODPROOF_TECHNICAL_SPEC.md §10:
--   "map new verified owners deliberately rather than auto-claiming demo
--   records"). `fp_verified_actor` only ever creates or refreshes the actor row
--   keyed by `auth_user_id`; it never looks at, links to, or rewrites the owner
--   of any existing content. Two people who used the same invitation code stay
--   two separate invitation actors, and their verified accounts are two more
--   separate actors again.
--
-- WHERE THE EMAIL LIVES.
--   The address itself is stored ONLY by the auth provider, in `auth.users`. The
--   application tables keep `email_hmac` — a keyed HMAC computed server-side
--   with `RATE_LIMIT_HMAC_KEY` — which is pseudonymous operational metadata for
--   support and for the moderator allowlist check, never a reversible address
--   and never an analytics property. The actor `label` is the constant string
--   'Verified account': an address must not leak into any table a reviewer,
--   the feed, or an export can read.
--
-- ROLES.
--   `role` for a verified actor is computed server-side on every sign-in from
--   the `MODERATOR_EMAILS` allowlist (lib/server/moderators.ts) and written
--   here. It is never taken from a request body. `lib/server/session.ts`
--   recomputes the expected role on every request and self-heals this column, so
--   the database-side reviewer check in `publication.ts` always agrees with the
--   allowlist that is deployed right now.
--
-- FK DIRECTION.
--   `auth_user_id` references `auth.users(id)` ON DELETE RESTRICT on purpose:
--   deleting the auth account must not silently orphan or cascade-destroy pilot
--   content. Deleting an account is an explicit, ordered operator procedure
--   (FOODPROOF_SETUP_AND_OPERATIONS.md).
--
-- HOW TO APPLY. There is no Supabase CLI, psql or database connection on the
-- build machine. The project owner pastes this file into the Supabase SQL Editor
-- of the DEDICATED DEMO project and runs it, AFTER 0001–0005. It is written to
-- be safe to re-run: `add column if not exists`, `create or replace`, and
-- catalogue-guarded `alter table ... add constraint`. `fp_schema_version()`
-- returns 6 afterwards, which is how the application and the tests check whether
-- it is applied; tests that need it report BLOCKED (skipped, never passed) until
-- it is.
--
-- IF `fp_verified_actor` REPORTS "permission denied for table users": the role
-- that owns the function cannot read `auth.users`. Run, once, as the SQL Editor's
-- own role:
--     grant usage on schema auth to postgres;
--     grant select on table auth.users to postgres;
-- and then re-run this file. The function is deliberately strict: it refuses the
-- sign-in rather than trusting the caller's word that an account is confirmed.
--
-- ORDER MATTERS. Apply this file BEFORE setting `EMAIL_SIGN_IN=true`. If the flag
-- is set first, the application keeps invitation entry working, logs one loud
-- line naming this file, and refuses email sign-in until it is applied
-- (lib/server/session.ts).
--
-- ERROR CONTRACT. Typed SQLSTATEs mapped by lib/server/errors.ts, unchanged from
-- 0004/0005 (FP402/FP403/FP404/FP409/FP422/FP429).

-- ---------------------------------------------------------------------------
-- Applied-schema probe.
-- ---------------------------------------------------------------------------
create or replace function fp_schema_version()
returns integer
language sql
immutable
set search_path = public
as $$
  select 6;
$$;

-- ---------------------------------------------------------------------------
-- 1. `demo_access` becomes an actor table with two identity kinds.
--
-- `token_hash` loses NOT NULL so a verified actor can exist without an
-- invitation code. Its UNIQUE constraint from 0001 is untouched, and Postgres
-- allows many NULLs under a unique constraint, so every verified actor row
-- coexists with it. Nothing about invitation lookup changes: it still matches on
-- `token_hash = sha256(code)`, which can never match NULL.
-- ---------------------------------------------------------------------------
alter table demo_access alter column token_hash drop not null;

alter table demo_access add column if not exists auth_user_id uuid;
alter table demo_access add column if not exists email_hmac text;

comment on column demo_access.auth_user_id is
  'Verified account (auth.users.id) for an email sign-in actor; NULL for an invitation actor.';
comment on column demo_access.email_hmac is
  'Keyed HMAC of the verified address (server-side, RATE_LIMIT_HMAC_KEY). Pseudonymous operational metadata; never an analytics property, never reversible to the address.';

do $$
begin
  -- Uniqueness: one actor row per verified account. Also the conflict target
  -- `fp_verified_actor` upserts on, so it must exist before that function runs.
  if not exists (
    select 1 from pg_constraint
     where conname = 'demo_access_auth_user_id_key'
       and conrelid = 'demo_access'::regclass
  ) then
    alter table demo_access
      add constraint demo_access_auth_user_id_key unique (auth_user_id);
  end if;

  -- ON DELETE RESTRICT: pilot content is never silently destroyed or orphaned
  -- by an account deletion; see the operator procedure in the setup document.
  if not exists (
    select 1 from pg_constraint
     where conname = 'demo_access_auth_user_id_fkey'
       and conrelid = 'demo_access'::regclass
  ) then
    alter table demo_access
      add constraint demo_access_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete restrict;
  end if;

  -- Exactly one identity kind per row, enforced by the database.
  if not exists (
    select 1 from pg_constraint
     where conname = 'demo_access_identity_ck'
       and conrelid = 'demo_access'::regclass
  ) then
    alter table demo_access
      add constraint demo_access_identity_ck
      check ((token_hash is null) <> (auth_user_id is null));
  end if;
end $$;

-- No index on `email_hmac`: nothing looks an actor up by it. A session resolves
-- by `demo_sessions.access_id`, and sign-in resolves by `auth_user_id`, which
-- the unique constraint above already indexes.

-- ---------------------------------------------------------------------------
-- 2. Map a verified auth user onto an actor row.
--
-- SECURITY DEFINER because it must read `auth.users`, which the API roles cannot
-- read directly; `search_path` is pinned and every reference is schema
-- qualified. EXECUTE is granted to `service_role` only (revoked from
-- public/anon/authenticated at the bottom of this file), so the only caller is
-- the FoodProof server, after it has verified the one-time code itself.
--
-- The caller supplies the role it computed from the deployed allowlist; this
-- function never derives authority from anything a browser sent. An account that
-- is unconfirmed or currently banned cannot become an actor (FP403), and neither
-- can a revoked or expired actor row (FP403) — the same refusal an invitation
-- actor gets, so revoking access works identically for both identity kinds.
--
-- The upsert never touches `label`, `expires_at`, `revoked_at` or `created_at`
-- of an existing row: a returning tester keeps the same actor id, and an
-- operator's revocation survives the next sign-in attempt.
-- ---------------------------------------------------------------------------
create or replace function fp_verified_actor(
  p_user_id uuid,
  p_email_hmac text,
  p_role demo_role
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user auth.users%rowtype;
  v_access demo_access%rowtype;
begin
  if p_user_id is null then
    raise exception 'A verified account id is required.' using errcode = 'FP422';
  end if;

  select * into v_user from auth.users where id = p_user_id;
  if not found
     or v_user.email_confirmed_at is null
     or (v_user.banned_until is not null and v_user.banned_until > now()) then
    raise exception 'This account cannot sign in.' using errcode = 'FP403';
  end if;

  insert into demo_access (auth_user_id, email_hmac, role, label)
  values (
    p_user_id,
    p_email_hmac,
    coalesce(p_role, 'user'::demo_role),
    'Verified account'
  )
  on conflict (auth_user_id) do update
    set email_hmac = excluded.email_hmac,
        role = excluded.role
  returning * into v_access;

  -- Checked AFTER the upsert so one statement serializes concurrent sign-ins;
  -- the RAISE aborts the surrounding transaction, so a refused actor keeps the
  -- row exactly as the operator left it.
  if v_access.revoked_at is not null
     or (v_access.expires_at is not null and v_access.expires_at <= now()) then
    raise exception 'This account cannot sign in.' using errcode = 'FP403';
  end if;

  return v_access.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE lockdown for everything this file created or recreated.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_revokees text := 'public';
  v_functions text[] := array[
    'fp_schema_version()',
    'fp_verified_actor(uuid, text, demo_role)'
  ];
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    v_revokees := v_revokees || ', anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    v_revokees := v_revokees || ', authenticated';
  end if;

  foreach v_fn in array v_functions loop
    execute format('revoke all on function %s from %s;', v_fn, v_revokees);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role;', v_fn);
    end if;
  end loop;
end $$;

-- Make the new function and columns visible to the REST layer immediately.
-- If a call still returns PGRST202 ("Could not find the function") or a read
-- still reports a missing column, run this line again.
notify pgrst, 'reload schema';
