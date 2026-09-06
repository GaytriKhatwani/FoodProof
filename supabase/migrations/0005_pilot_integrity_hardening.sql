-- FoodProof 0005 — pilot integrity hardening
-- (FOODPROOF_TECHNICAL_SPEC.md §5 and §9, FOODPROOF_API_DETAILS.md).
--
-- WHY.
--   1. Publication evidence coverage. A concern publication freezes the images
--      the community will see and a reviewer will judge. The share screen asks
--      the reporter to include the product identity, the gluten-free (or
--      relevant) claim, and the ingredients, but nothing on the trusted boundary
--      enforced that the SELECTED subset actually covered all three roles — a
--      caller bypassing the UI (or a UI defect) could freeze a concern that is
--      missing, say, the ingredients photo. `fp_request_publication` below now
--      rejects a concern revision unless the selected, ready label evidence
--      collectively covers identity, claim AND ingredients. Response revisions
--      are unchanged: their evidence stays optional and is never forced to cover
--      label roles.
--   2. Analytics endpoint flood protection. `/api/analytics` proxies
--      client-owned events to Mixpanel. It authenticated the session and checked
--      same-origin and consent, but had no rate limit, so a single consented
--      session could flood the demo project and corrupt the pilot counts. The
--      new `analytics_event_attempts` table + `record_analytics_event_attempt`
--      give the endpoint the SAME persistent, multi-instance-safe, tumbling
--      -window limiter shape already used for invitation attempts (0001), keyed
--      by an opaque subject the server derives — never a raw address, never a
--      value stored in an analytics event.
--   3. Abandoned AI reservations. A call that crashes between reserving and
--      settling leaves a `reserved` ledger row that (correctly) keeps counting
--      against the caps at its reserved maximum — fail-safe, never an
--      under-count. `fp_sweep_abandoned_ai_reservations` lets an OPERATOR release
--      only reservations far older than any possible in-flight request; it is
--      never called automatically and cannot release an active reservation.
--
-- HOW TO APPLY. There is no Supabase CLI or database connection on the build
-- machine. The project owner pastes this file into the Supabase SQL Editor of
-- the DEDICATED DEMO project and runs it, AFTER 0001–0004. It is idempotent:
-- `create table if not exists` and `create or replace` everywhere, plus
-- role-guarded grants, so re-running is safe. `fp_schema_version()` returns 5
-- afterwards, which is how the application and tests check whether it is applied;
-- tests that need it report BLOCKED (skipped, never passed) until it is.
--
-- SECURITY MODEL. As in 0003/0004: every function is SECURITY INVOKER with a
-- fixed `search_path`; only `service_role` may execute them or touch the new
-- table; EXECUTE is revoked from public/anon/authenticated. No `security
-- definer`. This file never edits 0004; it only replaces `fp_request_publication`
-- (via `create or replace`) and adds new objects.
--
-- ERROR CONTRACT. Typed SQLSTATEs mapped by lib/server/errors.ts, unchanged from
-- 0004 (FP402/FP403/FP404/FP409/FP422/FP429).

-- ---------------------------------------------------------------------------
-- Applied-schema probe.
-- ---------------------------------------------------------------------------
create or replace function fp_schema_version()
returns integer
language sql
immutable
set search_path = public
as $$
  select 5;
$$;

-- ---------------------------------------------------------------------------
-- 1. Atomic publication request WITH concern evidence-coverage.
--
-- Identical to 0004 in every respect except the added coverage check for a
-- concern revision: the union of the label roles carried by the SELECTED, ready
-- evidence must include identity, claim and ingredients. The roles are read from
-- the owned `evidence` rows under the report lock, so the check runs on the
-- authoritative, current data — not on anything the client supplied.
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
  v_covered_roles text[] := array[]::text[];
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
  -- before uploading, because only this check runs under the lock. For a
  -- concern, the label roles of the selected evidence are accumulated so their
  -- collective coverage can be enforced below.
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
    if v_content_kind = 'concern' then
      v_covered_roles := v_covered_roles || coalesce(v_ev.roles, array[]::text[]);
    end if;
  end loop;

  -- A concern snapshot must collectively show identity, claim AND ingredients.
  -- The share screen enforces this in the UI; this is the trusted-boundary
  -- backstop that a bypassing caller (or a UI defect) cannot evade.
  if v_content_kind = 'concern'
     and not (array['identity', 'claim', 'ingredients']::text[] <@ v_covered_roles) then
    raise exception 'The selected photos must together show the product identity, the gluten-free (or relevant) claim, and the ingredients.'
      using errcode = 'FP422';
  end if;

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
-- 2. Persistent analytics-endpoint rate limiter.
--
-- Same shape and guarantees as `demo_access_attempts` / `record_access_attempt`
-- (0001): a tumbling fixed window, atomic create-or-increment under a UNIQUE
-- (subject, window) constraint, so concurrent events on multiple Vercel
-- instances coalesce correctly. `subject` is an opaque server-derived id (the
-- session's access id), never a raw IP address and never written to any
-- analytics event. Expired rows are removed opportunistically by the caller.
-- ---------------------------------------------------------------------------
create table if not exists analytics_event_attempts (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  expires_at timestamptz not null,
  unique (subject, window_started_at)
);

create index if not exists analytics_event_attempts_expires_idx
  on analytics_event_attempts (expires_at);

alter table analytics_event_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table analytics_event_attempts from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table analytics_event_attempts from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all privileges on table analytics_event_attempts to service_role';
  end if;
end $$;

-- Atomic create-or-increment for the current window; returns the new count.
create or replace function record_analytics_event_attempt(
  p_subject text,
  p_window timestamptz,
  p_expires timestamptz
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into analytics_event_attempts (subject, window_started_at, attempt_count, expires_at)
  values (p_subject, p_window, 1, p_expires)
  on conflict (subject, window_started_at)
  do update set attempt_count = analytics_event_attempts.attempt_count + 1
  returning attempt_count into v_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Operator-only release of ABANDONED AI reservations.
--
-- A reserved ledger row keeps counting against the caps at its reserved maximum
-- until it is settled or released — the safe default when a call crashes between
-- reserve and settle. This function lets an operator reclaim only reservations
-- that are DEFINITELY abandoned: older than `p_older_than_seconds`, which the
-- caller must set far beyond the 30 s provider timeout (a floor of 3600 s is
-- enforced here so an active or recently-completed request can never be
-- released). It is never called automatically. Idempotent: an already-closed row
-- is left untouched.
-- ---------------------------------------------------------------------------
create or replace function fp_sweep_abandoned_ai_reservations(
  p_older_than_seconds integer
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_floor integer := 3600;
  v_threshold integer;
  v_released integer;
begin
  if p_older_than_seconds is null then
    raise exception 'An age threshold in seconds is required.' using errcode = 'FP422';
  end if;
  v_threshold := greatest(p_older_than_seconds, v_floor);

  with swept as (
    update ai_spend_ledger
       set state = 'released',
           settled_micros = 0,
           settled_at = now()
     where state = 'reserved'
       and created_at < now() - make_interval(secs => v_threshold)
    returning 1
  )
  select count(*) into v_released from swept;

  return jsonb_build_object(
    'released', v_released,
    'threshold_seconds', v_threshold
  );
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
    'fp_request_publication(uuid, uuid, uuid, integer, jsonb, jsonb)',
    'record_analytics_event_attempt(text, timestamptz, timestamptz)',
    'fp_sweep_abandoned_ai_reservations(integer)'
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

-- Make the new function and table visible to the REST layer immediately.
-- If a call still returns PGRST202 ("Could not find the function"), run this
-- line again.
notify pgrst, 'reload schema';
