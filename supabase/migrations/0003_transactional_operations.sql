-- FoodProof 0003 — transactional multi-step operations + RPC EXECUTE lockdown
-- (FOODPROOF_TECHNICAL_SPEC.md §3 and §5, FOODPROOF_API_DETAILS.md).
--
-- WHY. supabase-js cannot run several statements in one transaction, so T1
-- performed publication approval, withdrawal, reviewer removal, flag removal,
-- relinking and close/reopen as a sequence of guarded writes. A failure between
-- two of those steps could leave a contradictory projection, for example a
-- publication hidden while a pending revision stayed approvable (so a later
-- approval resurrected withdrawn content), or a timeline "closed" entry on a
-- report whose lifecycle is still open. Each operation below now happens inside
-- ONE database transaction: either all of it lands or none of it does.
--
-- HOW TO APPLY. There is no Supabase CLI or database connection on the build
-- machine. The project owner pastes this file into the Supabase SQL Editor of
-- the DEDICATED DEMO project and runs it. It is idempotent: `create or replace`
-- everywhere and role-guarded grants, so re-running is safe. `fp_schema_version()`
-- returns 3 afterwards, which is how the application and the tests check whether
-- it is applied. Tests that need it report BLOCKED (skipped, never passed) until
-- it is.
--
-- SECURITY MODEL. Every function is SECURITY INVOKER (the default) with a fixed
-- `search_path`, so it carries no privilege of its own: only `service_role`
-- (which the server-only secret key uses) may execute it, and only `service_role`
-- has the table privileges the bodies need. There is deliberately NO
-- `security definer` here — nothing in these operations needs to run with more
-- authority than the caller already has, and a definer function reachable from
-- PostgREST would be a privilege-escalation surface.
--
-- ERROR CONTRACT. Guard failures raise a typed SQLSTATE that lib/server/errors.ts
-- maps onto the existing API error codes, so HTTP responses do not change:
--     FP403 -> FORBIDDEN            FP404 -> NOT_FOUND
--     FP409 -> CONFLICT             FP422 -> VALIDATION_FAILED
-- The raised messages are the same strings the TypeScript services used before.

-- ---------------------------------------------------------------------------
-- Applied-schema probe. Cheap enough to call from a test's collection phase.
-- ---------------------------------------------------------------------------
create or replace function fp_schema_version()
returns integer
language sql
immutable
set search_path = public
as $$
  select 3;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (prefixed fp__). Not called directly by the application.
-- ---------------------------------------------------------------------------

-- Reviewer role read from the stored record, never from the request.
create or replace function fp__assert_reviewer(p_access_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_role demo_role;
begin
  select role into v_role from demo_access where id = p_access_id;
  if v_role is null or v_role <> 'reviewer' then
    raise exception 'Reviewer access is required.' using errcode = 'FP403';
  end if;
end;
$$;

-- Hide a publication, invalidate every revision that could still be approved,
-- and record the audit event. The CALLER must already hold the reports row lock
-- and have verified that the report exists and the actor is a reviewer.
create or replace function fp__remove_content_locked(
  p_report_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns void
language plpgsql
set search_path = public
as $$
begin
  update publications
     set visible = false,
         hidden_at = now()
   where report_id = p_report_id
     and visible = true;

  -- Approved content disappears; anything still reviewable is cancelled, so a
  -- later decision cannot resurrect removed content.
  update publication_revisions
     set state = 'removed'
   where report_id = p_report_id
     and state in ('approved', 'pending_review', 'changes_requested');

  insert into report_events (report_id, actor_access_id, type, metadata)
  values (
    p_report_id,
    p_reviewer,
    'content_removed',
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication approval: revision state + publication pointer in one transaction
-- (FOODPROOF_TECHNICAL_SPEC.md §5: "Approval transaction updates revision state
-- and the publication pointer together"). The reports row is locked first, and
-- withdrawal/removal below take the same lock, so an approval can never
-- interleave with a withdrawal and republish hidden content.
-- ---------------------------------------------------------------------------
create or replace function fp_decide_review(
  p_revision_id uuid,
  p_reviewer uuid,
  p_expected_version integer,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report_id uuid;
  v_rev publication_revisions%rowtype;
  v_row publication_revisions%rowtype;
  v_pub publications%rowtype;
  v_has_pub boolean;
  v_next revision_state;
  v_event text;
begin
  perform fp__assert_reviewer(p_reviewer);

  if p_action not in ('approve', 'request_changes', 'reject') then
    raise exception 'Unknown decision action.' using errcode = 'FP422';
  end if;

  select report_id into v_report_id
    from publication_revisions
   where id = p_revision_id;
  if v_report_id is null then
    raise exception 'Review request not found.' using errcode = 'FP404';
  end if;

  -- Single serialization point per report (see withdraw/remove below).
  perform 1 from reports where id = v_report_id for update;

  select * into v_rev
    from publication_revisions
   where id = p_revision_id
     for update;
  if not found then
    raise exception 'Review request not found.' using errcode = 'FP404';
  end if;

  if v_rev.state <> 'pending_review' then
    raise exception 'This request has already been decided.' using errcode = 'FP409';
  end if;
  -- `expected_version` is nullable in the request contract; a missing guard is
  -- treated as stale, never as "skip the check" (NULL <> n is NULL, not false).
  if p_expected_version is null or v_rev.version <> p_expected_version then
    raise exception 'This changed since you loaded it. Reload and retry.' using errcode = 'FP409';
  end if;
  if p_action in ('request_changes', 'reject')
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception 'A reason is required for this decision.' using errcode = 'FP422';
  end if;

  v_next := (case p_action
               when 'approve' then 'approved'
               when 'request_changes' then 'changes_requested'
               else 'rejected'
             end)::revision_state;

  if p_action = 'approve' then
    select * into v_pub from publications where report_id = v_report_id for update;
    v_has_pub := found;

    if v_rev.source_update_id is null then
      -- A stale approval must never resurrect withdrawn or removed content:
      -- refuse when the publication was hidden AFTER this revision was
      -- requested. A revision requested after the hide is a NEW consented
      -- request and may legitimately republish.
      if v_has_pub
         and v_pub.hidden_at is not null
         and v_pub.hidden_at > v_rev.created_at then
        raise exception 'This concern was withdrawn or removed after the request was submitted.'
          using errcode = 'FP409';
      end if;
    else
      -- A response is only ever attached to a visible parent publication.
      if not v_has_pub or not v_pub.visible then
        raise exception 'The parent concern is not published.' using errcode = 'FP409';
      end if;
    end if;
  end if;

  update publication_revisions
     set state = v_next,
         reviewed_by = p_reviewer,
         reviewed_at = now(),
         reason = p_reason,
         version = v_rev.version + 1
   where id = p_revision_id
     and version = v_rev.version
     and state = 'pending_review'
  returning * into v_row;
  if not found then
    raise exception 'This changed since you loaded it. Reload and retry.' using errcode = 'FP409';
  end if;

  -- Approving a CONCERN revision moves the pointer; a response snapshot never
  -- replaces it (FOODPROOF_API_DETAILS.md).
  if p_action = 'approve' and v_rev.source_update_id is null then
    insert into publications (report_id, approved_revision_id, visible, approved_at, hidden_at)
    values (v_report_id, p_revision_id, true, now(), null)
    on conflict (report_id) do update
      set approved_revision_id = excluded.approved_revision_id,
          visible = true,
          approved_at = excluded.approved_at,
          hidden_at = null;
  end if;

  v_event := case p_action
               when 'approve' then 'review_approved'
               when 'request_changes' then 'review_changes_requested'
               else 'review_rejected'
             end;

  insert into report_events (report_id, actor_access_id, type, related_entity_id, metadata)
  values (
    v_report_id,
    p_reviewer,
    v_event,
    p_revision_id,
    case when p_reason is null then null else jsonb_build_object('reason', p_reason) end
  );

  return jsonb_build_object(
    'publication_revision_id', v_row.id,
    'source_update_id', v_row.source_update_id,
    'state', v_row.state,
    'reason', v_row.reason,
    'revision', v_row.revision,
    'created_at', v_row.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporter withdrawal: hide the publication, withdraw the approved concern and
-- its dependent approved responses, cancel anything still in review, and record
-- the audit event — all atomically. Without this, a failure between the hide and
-- the cancel left a pending revision that a reviewer could still approve.
-- ---------------------------------------------------------------------------
create or replace function fp_withdraw_publication(
  p_report_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_approved uuid;
  v_visible boolean;
begin
  select owner_access_id into v_owner from reports where id = p_report_id for update;
  -- NOT_FOUND for a missing report AND for another owner's report.
  if not found or v_owner <> p_actor then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  select approved_revision_id, visible into v_approved, v_visible
    from publications
   where report_id = p_report_id
     for update;

  if found and v_visible then
    update publications
       set visible = false,
           hidden_at = now()
     where report_id = p_report_id;

    update publication_revisions
       set state = 'withdrawn'
     where id = v_approved
       and state = 'approved';

    -- Withdrawing a parent hides all of its responses and their assets
    -- (FOODPROOF_TECHNICAL_SPEC.md §5).
    update publication_revisions
       set state = 'withdrawn'
     where report_id = p_report_id
       and source_update_id is not null
       and state = 'approved';
  end if;

  update publication_revisions
     set state = 'withdrawn'
   where report_id = p_report_id
     and state = 'pending_review';

  insert into report_events (report_id, actor_access_id, type)
  values (p_report_id, p_actor, 'publication_withdrawn');

  return jsonb_build_object('report_id', p_report_id, 'withdrawn', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer removal (moderation). Same atomicity requirement as withdrawal.
-- ---------------------------------------------------------------------------
create or replace function fp_remove_content(
  p_report_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  perform fp__assert_reviewer(p_reviewer);

  perform 1 from reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  perform fp__remove_content_locked(p_report_id, p_reviewer, p_reason);
  return jsonb_build_object('report_id', p_report_id, 'removed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Flag resolution, optionally with removal. Resolving and removing in one
-- transaction stops a handled flag from pointing at content that is still
-- published (or removed content from leaving its flag open).
-- ---------------------------------------------------------------------------
create or replace function fp_resolve_flag(
  p_flag_id uuid,
  p_reviewer uuid,
  p_note text,
  p_remove boolean
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report_id uuid;
begin
  perform fp__assert_reviewer(p_reviewer);

  select report_id into v_report_id from content_flags where id = p_flag_id;
  if v_report_id is null then
    raise exception 'Flag not found.' using errcode = 'FP404';
  end if;

  perform 1 from reports where id = v_report_id for update;
  if not found then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  perform 1 from content_flags where id = p_flag_id for update;

  if coalesce(p_remove, false) then
    perform fp__remove_content_locked(
      v_report_id,
      p_reviewer,
      coalesce(p_note, 'Removed after flag review.')
    );
  end if;

  update content_flags
     set state = 'handled',
         reviewer_note = p_note
   where id = p_flag_id;

  insert into report_events (report_id, actor_access_id, type, related_entity_id, metadata)
  values (
    v_report_id,
    p_reviewer,
    'flag_resolved',
    p_flag_id,
    case when p_note is null then null else jsonb_build_object('note', p_note) end
  );

  return jsonb_build_object('flag_id', p_flag_id, 'state', 'handled', 'report_id', v_report_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer relink. The product change and its audit record are one unit, so a
-- moderator action can never land without the log that explains it
-- (FOODPROOF_API_DETAILS.md: "Reviewer relinking logs old/new product IDs and
-- reason").
-- ---------------------------------------------------------------------------
create or replace function fp_relink_product(
  p_report_id uuid,
  p_reviewer uuid,
  p_product_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_from uuid;
begin
  perform fp__assert_reviewer(p_reviewer);

  select product_id into v_from from reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  perform 1 from products where id = p_product_id;
  if not found then
    raise exception 'Target product not found.' using errcode = 'FP422';
  end if;

  update reports set product_id = p_product_id where id = p_report_id;

  insert into report_events (report_id, actor_access_id, type, metadata)
  values (
    p_report_id,
    p_reviewer,
    'product_relinked',
    jsonb_build_object('from', v_from, 'to', p_product_id, 'reason', p_reason)
  );

  return jsonb_build_object('report_id', p_report_id, 'product_id', p_product_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporter close / reopen. The timeline entry and the lifecycle change are one
-- unit: previously the audit `updates` row was inserted first, so a failed or
-- stale lifecycle update left a "closed" entry on a report that is still open.
-- ---------------------------------------------------------------------------
create or replace function fp_set_lifecycle(
  p_report_id uuid,
  p_owner uuid,
  p_to text,
  p_audit_kind text,
  p_summary text,
  p_close_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report reports%rowtype;
  v_from lifecycle;
begin
  if p_to not in ('open', 'closed_by_reporter')
     or p_audit_kind not in ('closed', 'reopened') then
    raise exception 'Unknown lifecycle transition.' using errcode = 'FP422';
  end if;

  select * into v_report from reports where id = p_report_id for update;
  if not found or v_report.owner_access_id <> p_owner then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  v_from := (case when p_to = 'closed_by_reporter' then 'open'
                  else 'closed_by_reporter' end)::lifecycle;
  if v_report.lifecycle <> v_from then
    if p_to = 'closed_by_reporter' then
      raise exception 'This report is already closed.' using errcode = 'FP409';
    else
      raise exception 'This report is already open.' using errcode = 'FP409';
    end if;
  end if;

  insert into updates (report_id, kind, occurred_at, summary, actor_access_id)
  values (
    p_report_id,
    p_audit_kind::update_kind,
    (now() at time zone 'utc')::date,
    p_summary,
    p_owner
  );

  update reports
     set lifecycle = p_to::lifecycle,
         close_reason = p_close_reason,
         version = v_report.version + 1,
         updated_at = now()
   where id = p_report_id
     and version = v_report.version;
  if not found then
    raise exception 'This report changed since you loaded it.' using errcode = 'FP409';
  end if;

  insert into report_events (report_id, actor_access_id, type)
  values (
    p_report_id,
    p_owner,
    case when p_to = 'closed_by_reporter' then 'report_closed' else 'report_reopened' end
  );

  return jsonb_build_object('report_id', p_report_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE lockdown.
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and Supabase's
-- default privileges add anon/authenticated as well, so every function in the
-- `public` schema is reachable as a PostgREST RPC by a browser holding only the
-- publishable key. 0001 granted service_role but never revoked those defaults:
-- `norm()` was therefore callable by anon (it returned a result), and
-- `record_access_attempt()` was reachable too (it failed only because anon has
-- no privilege on the limiter table, leaking the internal reason). The demo
-- boundary is "no direct client access" (§7), so EXECUTE is revoked from
-- public/anon/authenticated on every function in this schema and granted back to
-- service_role alone. The direct-client test in tests/integration/boundary.test.ts
-- proves the denial.
--
-- `norm(text)` also appears in the `products_identity_key` index expression, and
-- Postgres does check EXECUTE when it evaluates an index expression: the only
-- writers of `products` are service_role (granted below) and the migration owner
-- (implicitly privileged), so index maintenance is unaffected.
--
-- Guarded and idempotent: roles are only referenced when they exist.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_revokees text := 'public';
  v_functions text[] := array[
    'fp_schema_version()',
    'fp__assert_reviewer(uuid)',
    'fp__remove_content_locked(uuid, uuid, text)',
    'fp_decide_review(uuid, uuid, integer, text, text)',
    'fp_withdraw_publication(uuid, uuid)',
    'fp_remove_content(uuid, uuid, text)',
    'fp_resolve_flag(uuid, uuid, text, boolean)',
    'fp_relink_product(uuid, uuid, uuid, text)',
    'fp_set_lifecycle(uuid, uuid, text, text, text, text)',
    'norm(text)',
    'record_access_attempt(text, timestamptz, timestamptz)'
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

-- New functions added later must not silently inherit the PUBLIC default again.
alter default privileges in schema public revoke execute on functions from public;

-- Make the new functions visible to the REST layer immediately. Supabase also
-- reloads on its own; this only removes the wait. If a call still returns
-- PGRST202 ("Could not find the function"), run this line again.
notify pgrst, 'reload schema';
