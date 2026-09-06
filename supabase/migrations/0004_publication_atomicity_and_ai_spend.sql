-- FoodProof 0004 — atomic publication requests, AI spend ledger, and richer
-- transactional return values for server-owned analytics events
-- (FOODPROOF_TECHNICAL_SPEC.md §5 and §8, FOODPROOF_API_DETAILS.md,
-- FOODPROOF_MEASUREMENT_AND_PILOT.md §3).
--
-- WHY.
--   1. A publication request used to insert its `pending_review` revision row
--      FIRST and freeze the sanitized asset copies afterwards, one Storage
--      upload + one `publication_assets` insert at a time. A Storage or
--      database failure in the middle left a pending revision with fewer
--      assets than the reporter selected — and a reviewer could approve it.
--      `fp_request_publication` below writes the revision, its asset rows and
--      the audit event in ONE transaction, re-checking every guard under the
--      report row lock. The server now uploads the sanitized copies BEFORE
--      calling it, so a Storage failure leaves no revision at all, and a
--      database failure leaves only orphaned reviewed objects (deleted
--      best-effort by the server; never an approvable, incomplete revision).
--   2. Live AI assistance (T4) must never exceed the owner's hard spend cap.
--      `ai_spend_ledger` + `fp_reserve_ai_spend` reserve an estimated maximum
--      cost atomically BEFORE every provider call (per-call, per-invitation
--      and pilot-wide caps plus a request-frequency limit, all checked under
--      one advisory lock), `fp_settle_ai_spend` records the real usage after
--      a successful call, and `fp_release_ai_spend` returns the reservation
--      after a failed one, so a retry is never charged twice. The ledger holds
--      costs and token counts ONLY — never prompts, images, extracted text or
--      generated drafts.
--   3. Server-owned mutation-success analytics events need the ids and
--      timestamps of what actually committed, so `fp_decide_review`,
--      `fp_withdraw_publication`, `fp_remove_content` and `fp_resolve_flag`
--      now return them (additive: every field 0003 returned is unchanged).
--
-- HOW TO APPLY. There is no Supabase CLI or database connection on the build
-- machine. The project owner pastes this file into the Supabase SQL Editor of
-- the DEDICATED DEMO project and runs it, AFTER 0001–0003. It is idempotent:
-- `create table if not exists`, `create or replace` everywhere (the one helper
-- whose return type changes is dropped and recreated), and role-guarded grants,
-- so re-running is safe. `fp_schema_version()` returns 4 afterwards, which is
-- how the application and the tests check whether it is applied. Tests that
-- need it report BLOCKED (skipped, never passed) until it is.
--
-- SECURITY MODEL. As in 0003: every function is SECURITY INVOKER with a fixed
-- `search_path`; only `service_role` may execute them or touch the new table;
-- EXECUTE is revoked from public/anon/authenticated. No `security definer`.
--
-- ERROR CONTRACT. Typed SQLSTATEs mapped by lib/server/errors.ts:
--     FP402 -> DEPENDENCY_UNAVAILABLE (AI budget exhausted; the UI shows the
--              generic "AI assistance unavailable—continue manually.")
--     FP403 -> FORBIDDEN            FP404 -> NOT_FOUND
--     FP409 -> CONFLICT             FP422 -> VALIDATION_FAILED
--     FP429 -> RATE_LIMITED (Retry-After seconds carried in the error HINT)

-- ---------------------------------------------------------------------------
-- Applied-schema probe.
-- ---------------------------------------------------------------------------
create or replace function fp_schema_version()
returns integer
language sql
immutable
set search_path = public
as $$
  select 4;
$$;

-- ---------------------------------------------------------------------------
-- 1. Atomic publication request.
--
-- p_payload is the allowlisted snapshot the SERVER built from owned data (never
-- a client payload). p_assets is a JSON array of
--   {"source_evidence_id": uuid, "object_path": text}
-- describing sanitized copies the server has ALREADY uploaded to the reviewed
-- bucket. Every guard the TypeScript service checked before uploading is
-- re-checked here under the report row lock, so a concurrent edit, withdrawal
-- or second request cannot interleave.
-- ---------------------------------------------------------------------------
create or replace function fp_request_publication(
  p_report_id uuid,
  p_actor uuid,
  p_source_update_id uuid,
  p_expected_version integer,
  p_payload jsonb,
  p_assets jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_report reports%rowtype;
  v_update updates%rowtype;
  v_pub publications%rowtype;
  v_ev evidence%rowtype;
  v_row publication_revisions%rowtype;
  v_asset jsonb;
  v_assets jsonb := coalesce(p_assets, '[]'::jsonb);
  v_revision integer;
  v_content_kind text := case when p_source_update_id is null then 'concern' else 'response' end;
begin
  if jsonb_typeof(v_assets) <> 'array' then
    raise exception 'Frozen assets must be a list.' using errcode = 'FP422';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Snapshot payload is missing.' using errcode = 'FP422';
  end if;

  -- Single serialization point per report (shared with decide/withdraw/remove).
  select * into v_report from reports where id = p_report_id for update;
  -- NOT_FOUND for a missing report AND for another owner's report.
  if not found or v_report.owner_access_id <> p_actor then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;
  if p_expected_version is null or v_report.version <> p_expected_version then
    raise exception 'This changed since you loaded it. Reload and retry.' using errcode = 'FP409';
  end if;

  if v_content_kind = 'concern' then
    if v_report.preparation <> 'ready' then
      raise exception 'Confirm facts and add identity, claim and ingredient photos before publishing.'
        using errcode = 'FP422';
    end if;
    if jsonb_array_length(v_assets) = 0 then
      raise exception 'Select at least one image.' using errcode = 'FP422';
    end if;
    perform 1 from publication_revisions
      where report_id = p_report_id
        and source_update_id is null
        and state = 'pending_review';
    if found then
      raise exception 'A review request is already pending for this concern.' using errcode = 'FP409';
    end if;
  else
    -- A response is only ever proposed under a visible parent publication.
    select * into v_pub from publications where report_id = p_report_id;
    if not found or not v_pub.visible then
      raise exception 'Publish the concern before adding a response.' using errcode = 'FP409';
    end if;
    select * into v_update from updates where id = p_source_update_id;
    if not found or v_update.report_id <> p_report_id or v_update.kind <> 'response' then
      raise exception 'source_update_id must be a recorded response on this report.'
        using errcode = 'FP422';
    end if;
    if v_update.sender is null then
      raise exception 'The response must have a sender.' using errcode = 'FP422';
    end if;
    perform 1 from publication_revisions
      where source_update_id = p_source_update_id
        and state = 'pending_review';
    if found then
      raise exception 'A review request is already pending for this response.' using errcode = 'FP409';
    end if;
  end if;

  -- Every frozen asset must be READY image evidence of THIS report; concern
  -- assets must be label images. Checked here even though the server checked
  -- before uploading, because only this check runs under the lock.
  for v_asset in select value from jsonb_array_elements(v_assets) loop
    if coalesce(v_asset->>'source_evidence_id', '') = ''
       or coalesce(v_asset->>'object_path', '') = '' then
      raise exception 'Frozen asset is incomplete.' using errcode = 'FP422';
    end if;
    select * into v_ev from evidence where id = (v_asset->>'source_evidence_id')::uuid;
    if not found or v_ev.report_id <> p_report_id then
      raise exception 'Selected evidence does not belong to this report.' using errcode = 'FP422';
    end if;
    if v_ev.upload_state <> 'ready' then
      raise exception 'Selected evidence is not ready.' using errcode = 'FP422';
    end if;
    if v_content_kind = 'concern' and v_ev.kind <> 'label' then
      raise exception 'Concern assets must be label images.' using errcode = 'FP422';
    end if;
    if v_ev.mime_type not like 'image/%' then
      raise exception 'Only images can be published as assets.' using errcode = 'FP422';
    end if;
  end loop;

  select coalesce(max(revision), 0) + 1 into v_revision
    from publication_revisions
   where report_id = p_report_id;

  insert into publication_revisions
    (report_id, source_update_id, revision, payload, consented_at, requested_by, state, version)
  values
    (p_report_id, p_source_update_id, v_revision, p_payload, now(), p_actor, 'pending_review', 0)
  returning * into v_row;

  insert into publication_assets (revision_id, source_evidence_id, object_path)
  select v_row.id, (a->>'source_evidence_id')::uuid, a->>'object_path'
    from jsonb_array_elements(v_assets) a;

  insert into report_events (report_id, actor_access_id, type, related_entity_id, metadata)
  values (
    p_report_id,
    p_actor,
    'publication_requested',
    v_row.id,
    jsonb_build_object('content_kind', v_content_kind)
  );

  return jsonb_build_object(
    'publication_revision_id', v_row.id,
    'content_kind', v_content_kind,
    'state', v_row.state,
    'reason', null,
    'revision', v_row.revision,
    'created_at', v_row.created_at
  );
exception
  -- The partial unique indexes from 0001 are the backstop for the explicit
  -- pending checks above; surface them with the same message and code.
  when unique_violation then
    raise exception 'A review request is already pending for this %.', v_content_kind
      using errcode = 'FP409';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. AI spend ledger. Costs and token counts only — never content.
-- ---------------------------------------------------------------------------
create table if not exists ai_spend_ledger (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references demo_access(id) on delete cascade,
  report_id uuid references reports(id) on delete set null,
  operation text not null,
  channel channel,
  model text not null,
  state text not null default 'reserved',
  reserved_micros bigint not null,
  settled_micros bigint,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint ai_spend_ledger_operation_check check (operation in ('extract', 'draft')),
  constraint ai_spend_ledger_state_check check (state in ('reserved', 'settled', 'released')),
  constraint ai_spend_ledger_reserved_check check (reserved_micros >= 0),
  constraint ai_spend_ledger_settled_check check (settled_micros is null or settled_micros >= 0)
);

create index if not exists ai_spend_ledger_access_created_idx
  on ai_spend_ledger (access_id, created_at);
create index if not exists ai_spend_ledger_report_idx
  on ai_spend_ledger (report_id);

alter table ai_spend_ledger enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table ai_spend_ledger from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table ai_spend_ledger from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all privileges on table ai_spend_ledger to service_role';
  end if;
end $$;

-- What a ledger row currently counts against the caps: a released reservation
-- counts nothing, a settled one its real cost, an open one its reserved maximum.
create or replace function fp__ai_spend_effective(
  p_state text,
  p_reserved bigint,
  p_settled bigint
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select case p_state
           when 'released' then 0
           when 'settled' then coalesce(p_settled, p_reserved)
           else p_reserved
         end;
$$;

-- Reserve an estimated maximum cost before a provider call. All caps are
-- parameters (the server owns the limits; tests can pass tiny ones to prove
-- exhaustion deterministically). Reservations are serialized by an advisory
-- lock so two concurrent calls cannot both squeeze under a cap.
create or replace function fp_reserve_ai_spend(
  p_access_id uuid,
  p_report_id uuid,
  p_operation text,
  p_channel text,
  p_model text,
  p_reserve_micros bigint,
  p_per_call_cap_micros bigint,
  p_actor_cap_micros bigint,
  p_total_cap_micros bigint,
  p_rate_limit_calls integer,
  p_rate_limit_window_seconds integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_actor_spent bigint;
  v_total_spent bigint;
  v_recent integer;
  v_oldest timestamptz;
  v_retry_after integer;
  v_id uuid;
begin
  if p_operation not in ('extract', 'draft') then
    raise exception 'Unknown AI operation.' using errcode = 'FP422';
  end if;
  if p_reserve_micros is null or p_reserve_micros < 0
     or coalesce(p_model, '') = '' then
    raise exception 'Invalid AI reservation.' using errcode = 'FP422';
  end if;
  if p_channel is not null and p_channel not in ('brand', 'government') then
    raise exception 'Unknown channel.' using errcode = 'FP422';
  end if;

  perform 1 from demo_access where id = p_access_id and revoked_at is null;
  if not found then
    raise exception 'Access not found.' using errcode = 'FP404';
  end if;
  if p_report_id is not null then
    perform 1 from reports where id = p_report_id and owner_access_id = p_access_id;
    if not found then
      raise exception 'Report not found.' using errcode = 'FP404';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('fp_ai_spend_ledger'));

  if p_reserve_micros > p_per_call_cap_micros then
    raise exception 'This AI request would exceed the per-call cost limit.' using errcode = 'FP402';
  end if;

  select count(*), min(created_at) into v_recent, v_oldest
    from ai_spend_ledger
   where access_id = p_access_id
     and created_at > now() - make_interval(secs => p_rate_limit_window_seconds);
  if v_recent >= p_rate_limit_calls then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_oldest + make_interval(secs => p_rate_limit_window_seconds) - now())))::integer
    );
    raise exception 'Too many AI requests. Please wait and try again.'
      using errcode = 'FP429', hint = v_retry_after::text;
  end if;

  select coalesce(sum(fp__ai_spend_effective(state, reserved_micros, settled_micros)), 0)
    into v_actor_spent
    from ai_spend_ledger
   where access_id = p_access_id;
  if v_actor_spent + p_reserve_micros > p_actor_cap_micros then
    raise exception 'The AI budget for this invitation is used up.' using errcode = 'FP402';
  end if;

  select coalesce(sum(fp__ai_spend_effective(state, reserved_micros, settled_micros)), 0)
    into v_total_spent
    from ai_spend_ledger;
  if v_total_spent + p_reserve_micros > p_total_cap_micros then
    raise exception 'The AI budget for this pilot is used up.' using errcode = 'FP402';
  end if;

  insert into ai_spend_ledger
    (access_id, report_id, operation, channel, model, state, reserved_micros)
  values
    (p_access_id, p_report_id, p_operation, p_channel::channel, p_model, 'reserved', p_reserve_micros)
  returning id into v_id;

  return jsonb_build_object(
    'ledger_id', v_id,
    'actor_spent_micros', v_actor_spent,
    'total_spent_micros', v_total_spent
  );
end;
$$;

-- Record the real cost of a successful call. A settled row can never be
-- settled again; a released row can never be settled.
create or replace function fp_settle_ai_spend(
  p_ledger_id uuid,
  p_settled_micros bigint,
  p_input_tokens integer,
  p_output_tokens integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  if p_settled_micros is null or p_settled_micros < 0 then
    raise exception 'Invalid settled amount.' using errcode = 'FP422';
  end if;
  update ai_spend_ledger
     set state = 'settled',
         settled_micros = p_settled_micros,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         settled_at = now()
   where id = p_ledger_id
     and state = 'reserved';
  if not found then
    raise exception 'AI reservation not found or already closed.' using errcode = 'FP409';
  end if;
  return jsonb_build_object('ledger_id', p_ledger_id, 'state', 'settled');
end;
$$;

-- Return a reservation after a failed call so an identical retry is not charged
-- twice. Idempotent: releasing a row that is already closed changes nothing.
create or replace function fp_release_ai_spend(p_ledger_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_released boolean;
begin
  update ai_spend_ledger
     set state = 'released',
         settled_micros = 0,
         settled_at = now()
   where id = p_ledger_id
     and state = 'reserved';
  v_released := found;
  return jsonb_build_object('ledger_id', p_ledger_id, 'released', v_released);
end;
$$;

-- Operator/test read-back: what the ledger currently counts, pilot-wide.
create or replace function fp_ai_spend_totals()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'effective_micros', coalesce(sum(fp__ai_spend_effective(state, reserved_micros, settled_micros)), 0),
    'reserved_open', count(*) filter (where state = 'reserved'),
    'settled', count(*) filter (where state = 'settled'),
    'released', count(*) filter (where state = 'released')
  )
  from ai_spend_ledger;
$$;

-- ---------------------------------------------------------------------------
-- 3. Richer returns for server-owned analytics events (additive).
-- ---------------------------------------------------------------------------

-- fp__remove_content_locked now reports WHICH approved revision was hidden (or
-- null when nothing was visible). Its return type changes, so it is dropped
-- and recreated; plpgsql resolves the callers below by name at run time.
drop function if exists fp__remove_content_locked(uuid, uuid, text);
create function fp__remove_content_locked(
  p_report_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_hidden_revision uuid;
  v_now timestamptz := now();
begin
  update publications
     set visible = false,
         hidden_at = v_now
   where report_id = p_report_id
     and visible = true
  returning approved_revision_id into v_hidden_revision;

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

  return jsonb_build_object(
    'publication_revision_id', v_hidden_revision,
    'removed_at', v_now
  );
end;
$$;

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

  -- Single serialization point per report (see withdraw/remove/request).
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
  -- replaces it (FOODPROOF_API_DETAILS.md). Several approved RESPONSE
  -- revisions may exist for one source update over time (re-request after a
  -- correction); the public projection exposes only the latest approved one
  -- per source_update_id (lib/server/data.ts).
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
    'report_id', v_row.report_id,
    'source_update_id', v_row.source_update_id,
    'state', v_row.state,
    'reason', v_row.reason,
    'revision', v_row.revision,
    'created_at', v_row.created_at,
    'reviewed_at', v_row.reviewed_at
  );
end;
$$;

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
  v_hidden boolean := false;
  v_now timestamptz := now();
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
           hidden_at = v_now
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

    v_hidden := true;
  end if;

  update publication_revisions
     set state = 'withdrawn'
   where report_id = p_report_id
     and state = 'pending_review';

  insert into report_events (report_id, actor_access_id, type)
  values (p_report_id, p_actor, 'publication_withdrawn');

  return jsonb_build_object(
    'report_id', p_report_id,
    'withdrawn', true,
    'hidden', v_hidden,
    'publication_revision_id', case when v_hidden then v_approved else null end,
    'withdrawn_at', v_now
  );
end;
$$;

create or replace function fp_remove_content(
  p_report_id uuid,
  p_reviewer uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_removed jsonb;
begin
  perform fp__assert_reviewer(p_reviewer);

  perform 1 from reports where id = p_report_id for update;
  if not found then
    raise exception 'Report not found.' using errcode = 'FP404';
  end if;

  v_removed := fp__remove_content_locked(p_report_id, p_reviewer, p_reason);
  return jsonb_build_object(
    'report_id', p_report_id,
    'removed', true,
    'publication_revision_id', v_removed->'publication_revision_id',
    'removed_at', v_removed->'removed_at'
  );
end;
$$;

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
  v_removed jsonb := null;
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
    v_removed := fp__remove_content_locked(
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

  return jsonb_build_object(
    'flag_id', p_flag_id,
    'state', 'handled',
    'report_id', v_report_id,
    'removed', coalesce(p_remove, false),
    'publication_revision_id', v_removed->'publication_revision_id',
    'removed_at', v_removed->'removed_at'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- EXECUTE lockdown for everything this file created or recreated (0003's
-- `alter default privileges` already stops PUBLIC inheriting EXECUTE on new
-- functions; this makes the grant explicit and idempotent either way).
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_revokees text := 'public';
  v_functions text[] := array[
    'fp_schema_version()',
    'fp_request_publication(uuid, uuid, uuid, integer, jsonb, jsonb)',
    'fp__ai_spend_effective(text, bigint, bigint)',
    'fp_reserve_ai_spend(uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, integer, integer)',
    'fp_settle_ai_spend(uuid, bigint, integer, integer)',
    'fp_release_ai_spend(uuid)',
    'fp_ai_spend_totals()',
    'fp__remove_content_locked(uuid, uuid, text)',
    'fp_decide_review(uuid, uuid, integer, text, text)',
    'fp_withdraw_publication(uuid, uuid)',
    'fp_remove_content(uuid, uuid, text)',
    'fp_resolve_flag(uuid, uuid, text, boolean)'
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

-- Make the new functions and table visible to the REST layer immediately.
-- If a call still returns PGRST202 ("Could not find the function"), run this
-- line again.
notify pgrst, 'reload schema';
