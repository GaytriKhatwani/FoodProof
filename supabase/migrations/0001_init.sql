-- FoodProof phase-one initial schema (docs/FOODPROOF_TECHNICAL_SPEC.md §4/§5,
-- docs/FOODPROOF_API_DETAILS.md). Applied to a DEDICATED DEMO Supabase project.
-- The service role bypasses RLS; safety depends on server-side session, role,
-- ownership and input checks. RLS is deny-by-default: anon/authenticated grants
-- are revoked and no direct-client policies are created. Not applied by T0.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Canonical normalization: trim, collapse internal whitespace, case-fold.
-- The SAME key backs product matching and the products uniqueness constraint.
-- ---------------------------------------------------------------------------
create or replace function norm(txt text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g')));
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type demo_role as enum ('user', 'reviewer');
create type preparation as enum ('draft', 'ready');
create type lifecycle as enum ('open', 'closed_by_reporter');
create type evidence_kind as enum ('label', 'receipt', 'acknowledgement', 'response');
create type upload_state as enum ('pending', 'ready', 'failed');
create type channel as enum ('brand', 'government');
create type draft_method as enum ('template', 'assisted');
create type update_kind as enum ('follow_up', 'response', 'closed', 'reopened', 'label_change_claim');
create type revision_state as enum ('pending_review', 'changes_requested', 'rejected', 'approved', 'withdrawn', 'removed');
create type flag_state as enum ('open', 'handled');

-- ---------------------------------------------------------------------------
-- Access, sessions, limiter, idempotency
-- ---------------------------------------------------------------------------
create table demo_access (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  role demo_role not null,
  label text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table demo_sessions (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references demo_access(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  analytics_consent boolean not null default false,
  analytics_actor_id text,
  analytics_session_id text,
  created_at timestamptz not null default now()
);

-- Persistent invitation-attempt limiter. `address_hmac` is short-lived
-- pseudonymous security metadata: a keyed HMAC of the originating address,
-- never the raw address; used only for abuse limiting, never analytics/profiling.
create table demo_access_attempts (
  id uuid primary key default gen_random_uuid(),
  address_hmac text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0,
  expires_at timestamptz not null,
  unique (address_hmac, window_started_at)
);

-- Atomic create-or-increment for the current window; returns the new count.
create or replace function record_access_attempt(
  p_address_hmac text,
  p_window timestamptz,
  p_expires timestamptz
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into demo_access_attempts (address_hmac, window_started_at, attempt_count, expires_at)
  values (p_address_hmac, p_window, 1, p_expires)
  on conflict (address_hmac, window_started_at)
  do update set attempt_count = demo_access_attempts.attempt_count + 1
  returning attempt_count into v_count;
  return v_count;
end;
$$;

create table operation_receipts (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references demo_access(id) on delete cascade,
  operation text not null,
  idempotency_key uuid not null,
  request_hash text not null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  unique (actor_id, operation, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Products, reports, evidence
-- ---------------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  name text not null,
  variant text,
  dataset text not null default 'demo',
  created_at timestamptz not null default now(),
  constraint products_dataset_check check (dataset in ('demo', 'seed'))
);

-- Canonical identity uniqueness (matches norm() used for matching).
create unique index products_identity_key
  on products (norm(brand), norm(name), coalesce(norm(variant), ''));

create table reports (
  id uuid primary key default gen_random_uuid(),
  owner_access_id uuid not null references demo_access(id) on delete cascade,
  product_id uuid references products(id),
  product_name text not null,
  brand text not null,
  variant text,
  concern_text text,
  claim_text text,
  ingredients_text text,
  facts_confirmed_at timestamptz,
  observation_date date,
  batch_number text,
  preparation preparation not null default 'draft',
  lifecycle lifecycle not null default 'open',
  close_reason text,
  dataset text not null default 'demo',
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_dataset_check check (dataset in ('demo', 'seed'))
);

create index reports_owner_updated_idx on reports (owner_access_id, updated_at);
create index reports_product_idx on reports (product_id);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  object_path text unique not null,
  kind evidence_kind not null,
  roles text[] not null default '{}',
  mime_type text not null,
  bytes bigint not null,
  upload_state upload_state not null default 'pending',
  created_at timestamptz not null default now(),
  constraint evidence_roles_subset
    check (roles <@ array['identity', 'claim', 'ingredients']::text[])
);

-- ---------------------------------------------------------------------------
-- External history, drafts, updates
-- ---------------------------------------------------------------------------
create table submissions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  channel channel not null,
  recipient text not null,
  submitted_at date not null,
  reference text,
  acknowledgement_evidence_id uuid references evidence(id),
  created_at timestamptz not null default now()
);

create index submissions_report_idx on submissions (report_id);

create table complaint_drafts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  channel channel not null,
  subject text not null,
  body text not null,
  method draft_method not null,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (report_id, channel)
);

create table updates (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  submission_id uuid references submissions(id),
  kind update_kind not null,
  sender text,
  occurred_at date not null,
  summary text not null,
  evidence_id uuid references evidence(id),
  actor_access_id uuid not null references demo_access(id),
  created_at timestamptz not null default now(),
  constraint updates_submission_required
    check (kind not in ('response', 'follow_up') or submission_id is not null),
  constraint updates_response_fields
    check (kind <> 'response' or sender is not null)
);

create index updates_report_occurred_idx on updates (report_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Publication (immutable snapshots), pointer, assets, flags, audit
-- ---------------------------------------------------------------------------
create table publication_revisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  source_update_id uuid references updates(id),
  revision integer not null,
  payload jsonb not null,
  consented_at timestamptz,
  requested_by uuid not null references demo_access(id),
  state revision_state not null default 'pending_review',
  reviewed_by uuid references demo_access(id),
  reviewed_at timestamptz,
  reason text,
  version integer not null default 0,
  created_at timestamptz not null default now()
);

create index publication_revisions_state_created_idx
  on publication_revisions (state, created_at);

-- At most one pending CONCERN revision per report...
create unique index publication_revisions_one_pending_concern
  on publication_revisions (report_id)
  where state = 'pending_review' and source_update_id is null;

-- ...and at most one pending RESPONSE revision per source update.
create unique index publication_revisions_one_pending_response
  on publication_revisions (source_update_id)
  where state = 'pending_review' and source_update_id is not null;

create table publications (
  report_id uuid primary key references reports(id) on delete cascade,
  approved_revision_id uuid not null references publication_revisions(id),
  visible boolean not null default true,
  approved_at timestamptz not null default now(),
  hidden_at timestamptz
);

create table publication_assets (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references publication_revisions(id) on delete cascade,
  source_evidence_id uuid not null references evidence(id),
  object_path text unique not null
);

create table content_flags (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  requested_by uuid references demo_access(id),
  reason text not null,
  state flag_state not null default 'open',
  reviewer_note text,
  created_at timestamptz not null default now()
);

-- Server-written internal audit; private reasons never projected publicly.
create table report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  actor_access_id uuid references demo_access(id),
  type text not null,
  occurred_at timestamptz not null default now(),
  related_entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index report_events_report_occurred_idx
  on report_events (report_id, occurred_at);

-- ---------------------------------------------------------------------------
-- RLS deny-by-default. Revoke anon/authenticated; create NO direct-client
-- policies. All access flows through the server-only service role.
-- Storage buckets `demo-originals` and `demo-reviewed` are created privately by
-- the operator setup step, not here.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'demo_access', 'demo_sessions', 'demo_access_attempts', 'operation_receipts',
    'products', 'reports', 'evidence', 'submissions', 'complaint_drafts',
    'updates', 'publication_revisions', 'publications', 'publication_assets',
    'content_flags', 'report_events'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('revoke all on table %I from anon, authenticated;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Server access. The service role bypasses RLS (BYPASSRLS) but still needs
-- table privileges. Grant them explicitly rather than depending on the
-- project's default privileges, so the boundary holds on any demo project:
-- service_role is the ONLY role with access; anon/authenticated stay revoked.
-- ---------------------------------------------------------------------------
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
