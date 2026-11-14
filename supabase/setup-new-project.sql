-- Universal Content Studio: complete schema for a NEW Supabase project.
-- Paste into Supabase → SQL Editor → Run. Generated from supabase/migrations/*.sql (do not edit by hand).
begin;
create table if not exists public.app_migrations (name text primary key, applied_at timestamptz not null default now());
alter table public.app_migrations enable row level security;

-- ===== 0001_foundation.sql =====
-- Universal Content Studio: multi-tenant foundation.
-- Targets Supabase (PostgreSQL 15+). Tenant isolation is enforced twice:
--   1. Row Level Security on every table, driven by app.can(org, workspace, permission).
--   2. Composite foreign keys, so a row can never reference a workspace of another
--      organization or a brand of another workspace (brand identities cannot be mixed).

create schema if not exists app;

-- ---------------------------------------------------------------- identity
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table roles (
  key text primary key,
  label text not null,
  rank int not null,
  can_manage boolean not null default false,   -- members, providers, budgets, automation
  can_edit boolean not null default false,     -- create and change brands, briefs, content
  can_approve boolean not null default false,  -- approve content, approve/lock guidelines
  can_publish boolean not null default false,  -- schedule and confirm publications
  description text
);

insert into roles (key, label, rank, can_manage, can_edit, can_approve, can_publish, description) values
  ('owner',             'Organization owner', 100, true,  true,  true,  true,  'Full control, including billing limits and deletion.'),
  ('admin',             'Administrator',       90, true,  true,  true,  true,  'Manages members, providers, automation and budgets.'),
  ('creative_director', 'Creative director',   70, false, true,  true,  true,  'Owns brand guidelines; approves and publishes content.'),
  ('editor',            'Editor',              50, false, true,  false, true,  'Edits content and prepares publications.'),
  ('producer',          'Content producer',    40, false, true,  false, false, 'Creates briefs and runs production jobs.'),
  ('client_reviewer',   'Client reviewer',     20, false, false, true,  false, 'Reviews and approves content; cannot edit.'),
  ('viewer',            'Viewer',              10, false, false, false, false, 'Read-only access.');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  monthly_budget_usd numeric(12,2),
  emergency_stop boolean not null default false,
  emergency_stop_at timestamptz,
  emergency_stop_by uuid references auth.users(id),
  settings jsonb not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  automation_mode text not null default 'assisted'
    check (automation_mode in ('assisted', 'autonomous_production', 'full_automation')),
  full_automation_enabled_at timestamptz,
  full_automation_enabled_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, org_id),
  -- Full automation must have been explicitly activated by a named person.
  check (automation_mode <> 'full_automation'
         or (full_automation_enabled_at is not null and full_automation_enabled_by is not null))
);

-- workspace_id null  = organization-level membership (applies to every workspace)
-- workspace_id set   = access limited to that workspace
create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null references roles(key),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  unique nulls not distinct (org_id, workspace_id, user_id)
);
create index on memberships (user_id);

-- ---------------------------------------------------------------- permission helpers
create function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.org_id = p_org)
$$;

-- p_ws null checks an organization-level permission (only org-level memberships count).
create function app.can(p_org uuid, p_ws uuid, p_perm text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from memberships m
    join roles r on r.key = m.role
    where m.user_id = auth.uid()
      and m.org_id = p_org
      and (m.workspace_id is null or m.workspace_id = p_ws)
      and case p_perm
            when 'view' then true
            when 'edit' then r.can_edit
            when 'approve' then r.can_approve
            when 'publish' then r.can_publish
            when 'manage' then r.can_manage
            else false
          end
  )
$$;

-- ---------------------------------------------------------------- clients, brands
create table clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  name text not null,
  contact_name text,
  contact_email text,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  unique (id, workspace_id)
);

create table brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  client_id uuid,
  name text not null,
  slug text not null,
  tagline text,
  website text,
  industry text,
  market text,
  description text,
  logo_path text,
  primary_language text not null default 'en',
  languages text[] not null default '{en}',
  palette jsonb not null default '[]',      -- [{name, hex, role}]
  typography jsonb not null default '{}',   -- {heading, body, notes}
  status text not null default 'active' check (status in ('active', 'archived')),
  monthly_budget_usd numeric(12,2),
  is_sample boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (client_id, workspace_id) references clients(id, workspace_id),
  unique (id, workspace_id),
  unique (workspace_id, slug)
);

create table brand_guidelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null unique,
  positioning text,
  personality text[] not null default '{}',
  tone text,
  voice_do text[] not null default '{}',
  voice_dont text[] not null default '{}',
  visual_identity text,
  content_pillars jsonb not null default '[]',   -- [{name, description}]
  key_messages text[] not null default '{}',
  objectives text[] not null default '{}',
  creative_guidelines text,
  content_strategy text,
  production_requirements text,
  banned_terms text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'locked')),
  source text not null default 'manual' check (source in ('manual', 'template', 'ai')),
  generated_by text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  locked_by uuid references auth.users(id),
  locked_at timestamptz,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade
);

-- Locked guidelines are immutable until unlocked; approving / locking / unlocking needs
-- the 'approve' permission. Service connections (no auth.uid) are not restricted.
create function app.guard_brand_guidelines() returns trigger
language plpgsql as $$
begin
  if old.status = 'locked' and new.status = 'locked' then
    raise exception 'Brand guidelines are locked. Unlock them before editing.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and auth.uid() is not null
     and not app.can(new.org_id, new.workspace_id, 'approve') then
    raise exception 'Changing guideline status requires approval permission.' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger brand_guidelines_guard before update on brand_guidelines
  for each row execute function app.guard_brand_guidelines();

create table brand_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  kind text not null default 'reference'
    check (kind in ('logo', 'product_image', 'reference', 'marketing_material', 'font', 'other')),
  title text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  approved boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade
);

create table audiences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  name text not null,
  description text,
  demographics text,
  pains text[] not null default '{}',
  desires text[] not null default '{}',
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  unique (id, brand_id)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  name text not null,
  description text,
  price text,
  url text,
  features text[] not null default '{}',
  image_path text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------- projects, campaigns, briefs
create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  client_id uuid,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  budget_usd numeric(12,2),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  foreign key (client_id, workspace_id) references clients(id, workspace_id),
  unique (id, brand_id)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  project_id uuid,
  name text not null,
  objective text,
  key_message text,
  start_date date,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'in_production', 'active', 'completed', 'archived')),
  budget_usd numeric(12,2),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  foreign key (project_id, brand_id) references projects(id, brand_id),
  unique (id, brand_id)
);

create table content_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  project_id uuid,
  campaign_id uuid,
  audience_id uuid,
  title text not null,
  content_type text not null,
  description text not null,
  objective text,
  language text not null default 'en',
  platforms text[] not null default '{}',
  format text,
  key_points text[] not null default '{}',
  cta text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  foreign key (project_id, brand_id) references projects(id, brand_id),
  foreign key (campaign_id, brand_id) references campaigns(id, brand_id),
  foreign key (audience_id, brand_id) references audiences(id, brand_id),
  unique (id, brand_id)
);

-- ---------------------------------------------------------------- workflows, templates
-- org_id null = built-in default shipped with the platform. Resolution order (most
-- specific wins): brand + content_type, brand + module, org + content_type, org + module,
-- built-in + content_type, built-in + module.
create table workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade,
  brand_id uuid references brands(id) on delete cascade,
  module text not null,
  content_type text,
  name text not null,
  stages jsonb not null,   -- ordered array of stage keys
  created_at timestamptz not null default now(),
  check (brand_id is null or org_id is not null)
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid,
  brand_id uuid,
  module text not null,
  content_type text not null,
  name text not null,
  description text,
  body jsonb not null default '{}',   -- brief pre-fill: {description, objective, key_points, cta, format, platforms}
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade
);

-- ---------------------------------------------------------------- production jobs
create table content_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  project_id uuid,
  campaign_id uuid,
  brief_id uuid,
  module text not null,
  content_type text not null,
  title text not null,
  status text not null default 'queued' check (status in
    ('queued', 'running', 'paused_for_review', 'awaiting_approval', 'changes_requested', 'approved', 'rejected', 'failed', 'cancelled')),
  current_stage text,
  stages jsonb not null default '[]',        -- [{key, status, started_at, finished_at, note}]
  input jsonb not null default '{}',
  operating_mode text not null default 'assisted',
  estimated_cost_usd numeric(12,4) not null default 0,
  actual_cost_usd numeric(12,4) not null default 0,
  providers_used jsonb not null default '[]',
  errors jsonb not null default '[]',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  cancel_requested boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  foreign key (project_id, brand_id) references projects(id, brand_id),
  foreign key (campaign_id, brand_id) references campaigns(id, brand_id),
  foreign key (brief_id, brand_id) references content_briefs(id, brand_id),
  unique (id, brand_id)
);
create index content_jobs_queue on content_jobs (run_after) where status = 'queued';
create index on content_jobs (workspace_id, created_at desc);

-- ---------------------------------------------------------------- generated assets
create table scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  kind text not null default 'script',   -- script, strategy, concept, caption, article, copy, research ...
  title text not null,
  language text not null default 'en',
  body text not null,
  meta jsonb not null default '{}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table scenes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  script_id uuid references scripts(id) on delete cascade,
  position int not null,
  heading text,
  narration text,
  visual_description text,
  duration_seconds numeric(6,2),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  title text not null,
  storage_path text not null,
  mime_type text not null,
  width int,
  height int,
  meta jsonb not null default '{}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  title text not null,
  storage_path text not null,
  mime_type text not null,
  width int,
  height int,
  duration_seconds numeric(8,2),
  meta jsonb not null default '{}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table audio_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  title text not null,
  storage_path text not null,
  mime_type text not null,
  duration_seconds numeric(8,2),
  meta jsonb not null default '{}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  title text not null,
  storage_path text not null,
  mime_type text not null,
  meta jsonb not null default '{}',
  version int not null default 1,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

-- One read model over every asset table (RLS of the underlying tables applies).
create view content_assets with (security_invoker = true) as
  select id, 'script'::text as asset_kind, kind as subtype, org_id, workspace_id, brand_id, job_id, title,
         body, null::text as storage_path, 'text/markdown'::text as mime_type, meta, version, created_at from scripts
  union all
  select id, 'image', null, org_id, workspace_id, brand_id, job_id, title, null, storage_path, mime_type, meta, version, created_at from images
  union all
  select id, 'video', null, org_id, workspace_id, brand_id, job_id, title, null, storage_path, mime_type, meta, version, created_at from videos
  union all
  select id, 'audio', null, org_id, workspace_id, brand_id, job_id, title, null, storage_path, mime_type, meta, version, created_at from audio_assets
  union all
  select id, 'document', null, org_id, workspace_id, brand_id, job_id, title, null, storage_path, mime_type, meta, version, created_at from documents;

-- Previous states of an asset (written before every edit or regeneration).
create table versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  asset_kind text not null check (asset_kind in ('script', 'image', 'video', 'audio', 'document')),
  asset_id uuid not null,
  version_no int not null,
  body text,
  storage_path text,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  decision text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comment text,
  decided_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade
);

-- ---------------------------------------------------------------- distribution
create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  platform text not null,
  handle text not null,
  display_name text,
  -- 'manual': the account is only a publishing target for manual packages.
  -- 'api': reserved for verified platform integrations (none ship yet). No tokens are stored here.
  connection text not null default 'manual' check (connection in ('manual', 'api')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade,
  unique (brand_id, platform, handle),
  unique (id, brand_id)
);

create table publication_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid not null,
  campaign_id uuid,
  social_account_id uuid,
  platform text not null,
  caption text,
  asset_refs jsonb not null default '[]',   -- [{asset_kind, asset_id}]
  mode text not null default 'manual_package' check (mode in ('manual_package', 'api')),
  status text not null default 'draft' check (status in
    ('draft', 'scheduled', 'ready_manual', 'publishing', 'published', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  log jsonb not null default '[]',          -- [{at, event, detail}]
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (job_id, brand_id) references content_jobs(id, brand_id) on delete cascade,
  foreign key (campaign_id, brand_id) references campaigns(id, brand_id),
  foreign key (social_account_id, brand_id) references social_accounts(id, brand_id)
);
create index on publication_jobs (workspace_id, scheduled_at);

create table publication_results (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  publication_job_id uuid not null references publication_jobs(id) on delete cascade,
  status text not null check (status in ('confirmed', 'failed')),
  confirmation text not null check (confirmation in ('manual', 'api')),
  external_url text,
  external_id text,
  detail text,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  -- A confirmation must point at something verifiable.
  check (status <> 'confirmed' or external_url is not null or external_id is not null)
);

-- A publication can only be marked 'published' when a confirmed result exists, and only
-- approved content may leave draft.
create function app.guard_publication_jobs() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'published' and not exists (
    select 1 from publication_results r where r.publication_job_id = new.id and r.status = 'confirmed'
  ) then
    raise exception 'A publication cannot be marked published without a confirmed result.' using errcode = 'P0001';
  end if;
  if new.status in ('scheduled', 'ready_manual', 'publishing', 'published') and not exists (
    select 1 from content_jobs j where j.id = new.job_id and j.status = 'approved'
  ) then
    raise exception 'Only approved content can be scheduled or published.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger publication_jobs_guard before insert or update on publication_jobs
  for each row execute function app.guard_publication_jobs();

-- ---------------------------------------------------------------- analytics, providers, costs
create table analytics (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  campaign_id uuid,
  job_id uuid,
  publication_job_id uuid references publication_jobs(id) on delete set null,
  platform text not null,
  metric text not null check (metric in
    ('views', 'reach', 'engagement', 'retention', 'watch_time', 'clicks', 'shares', 'followers', 'conversions', 'revenue')),
  value numeric not null,
  period_start date not null,
  period_end date not null,
  source text not null default 'manual' check (source in ('manual', 'api')),
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade,
  foreign key (brand_id, workspace_id) references brands(id, workspace_id) on delete cascade
);

create table ai_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  adapter text not null,                 -- key of an installed adapter (src/lib/ai/adapters)
  name text not null,
  enabled boolean not null default true,
  priority int not null default 100,     -- lower runs first among equals
  capabilities text[] not null,          -- subset of what the adapter supports
  config jsonb not null default '{}',    -- {model, api_key_env, effort}; secrets stay in the environment
  pricing jsonb not null default '{}',   -- {input_per_mtok, output_per_mtok, per_image, per_second ...} in USD
  quality int not null default 3 check (quality between 1 and 5),
  speed int not null default 3 check (speed between 1 and 5),
  created_at timestamptz not null default now()
);

create table provider_usage (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  job_id uuid,
  provider_id uuid references ai_providers(id) on delete set null,
  adapter text not null,
  model text,
  capability text not null,
  stage text,
  input_units numeric not null default 0,
  output_units numeric not null default 0,
  unit text not null default 'tokens',
  cost_usd numeric(12,6) not null default 0,
  duration_ms int,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade
);

create table production_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  workspace_id uuid not null,
  brand_id uuid not null,
  project_id uuid,
  campaign_id uuid,
  job_id uuid,
  category text not null check (category in ('text', 'image', 'video', 'audio', 'rendering', 'storage', 'external')),
  description text,
  amount_usd numeric(12,6) not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, org_id) references workspaces(id, org_id) on delete cascade
);
create index on production_costs (org_id, created_at);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  workspace_id uuid,
  actor_id uuid references auth.users(id),
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system')),
  action text not null,
  entity_type text,
  entity_id uuid,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_logs (org_id, created_at desc);

-- ---------------------------------------------------------------- organization bootstrap
-- A signed-in user creates an organization through this function: it creates the org, a
-- first workspace, the owner membership and the built-in (non-AI) provider atomically.
create function app.create_organization(p_name text, p_workspace_name text default 'Main workspace')
returns table (org_id uuid, workspace_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_ws uuid;
  v_slug text;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Organization name is required'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'))
            || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into organizations (name, slug, created_by) values (trim(p_name), v_slug, v_user) returning id into v_org;
  insert into workspaces (org_id, name) values (v_org, coalesce(nullif(trim(p_workspace_name), ''), 'Main workspace'))
    returning id into v_ws;
  insert into memberships (org_id, user_id, role) values (v_org, v_user, 'owner');
  insert into ai_providers (org_id, adapter, name, priority, capabilities, quality, speed)
    values (v_org, 'local-template', 'Built-in template engine (no AI)', 900,
            array['text', 'layout_image', 'layout_video', 'document'], 1, 5);
  insert into audit_logs (org_id, workspace_id, actor_id, action, entity_type, entity_id)
    values (v_org, v_ws, v_user, 'organization.created', 'organization', v_org);
  return query select v_org, v_ws;
end $$;

-- ---------------------------------------------------------------- built-in workflows
insert into workflows (module, content_type, name, stages) values
  ('video',    null, 'Video production',
   '["brief","research","strategy","script","generation","quality_control","human_approval","distribution","analytics"]'),
  ('image',    null, 'Image production',
   '["brief","strategy","concept","generation","quality_control","human_approval","distribution","analytics"]'),
  ('writing',  null, 'Written content',
   '["brief","research","strategy","generation","quality_control","human_approval","distribution","analytics"]'),
  ('audio',    null, 'Audio production',
   '["brief","strategy","script","generation","quality_control","human_approval","distribution","analytics"]'),
  ('document', null, 'Documents and presentations',
   '["brief","research","strategy","generation","quality_control","human_approval"]'),
  ('writing',  'social_caption', 'Social caption (short)',
   '["brief","generation","quality_control","human_approval","distribution","analytics"]');
insert into public.app_migrations (name) values ('0001_foundation.sql');

-- ===== 0002_rls.sql =====
-- Row Level Security for every tenant table.
-- Permissions come from app.can(org_id, workspace_id, perm): view | edit | approve | publish | manage.
-- Background workers connect with a role that bypasses RLS (service role) and are
-- responsible for scoping every query by job.

-- Standard workspace-scoped tables: members with access to the workspace can read;
-- roles with can_edit can write.
do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'brands', 'brand_guidelines', 'brand_assets', 'audiences', 'products',
    'projects', 'campaigns', 'content_briefs', 'content_jobs',
    'scripts', 'scenes', 'images', 'videos', 'audio_assets', 'documents', 'versions',
    'social_accounts', 'analytics'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (app.can(org_id, workspace_id, ''view''))', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (app.can(org_id, workspace_id, ''edit''))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (app.can(org_id, workspace_id, ''edit'')) with check (app.can(org_id, workspace_id, ''edit''))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (app.can(org_id, workspace_id, ''edit''))', t || '_delete', t);
  end loop;

  -- Read-only for users; written by the worker (service role).
  foreach t in array array['provider_usage', 'production_costs'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (app.can(org_id, workspace_id, ''view''))', t || '_select', t);
  end loop;
end $$;

-- profiles: yourself, plus people you share an organization with.
alter table profiles enable row level security;
create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from memberships mine join memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id)
);
create policy profiles_insert on profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

alter table roles enable row level security;
create policy roles_select on roles for select to authenticated using (true);

-- organizations: created only through app.create_organization().
alter table organizations enable row level security;
create policy organizations_select on organizations for select to authenticated using (app.is_org_member(id));
create policy organizations_update on organizations for update to authenticated
  using (app.can(id, null, 'manage')) with check (app.can(id, null, 'manage'));

alter table workspaces enable row level security;
create policy workspaces_select on workspaces for select to authenticated using (app.can(org_id, id, 'view'));
create policy workspaces_insert on workspaces for insert to authenticated with check (app.can(org_id, null, 'manage'));
create policy workspaces_update on workspaces for update to authenticated
  using (app.can(org_id, id, 'manage')) with check (app.can(org_id, id, 'manage'));
create policy workspaces_delete on workspaces for delete to authenticated using (app.can(org_id, null, 'manage'));

-- memberships: see your own and those of workspaces you can view; managers administer.
-- Nobody can grant a role that outranks their own.
create function app.my_rank(p_org uuid, p_ws uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(max(r.rank), 0) from memberships m join roles r on r.key = m.role
  where m.user_id = auth.uid() and m.org_id = p_org and (m.workspace_id is null or m.workspace_id = p_ws)
$$;
create function app.role_rank(p_role text) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select rank from roles where key = p_role
$$;

alter table memberships enable row level security;
create policy memberships_select on memberships for select to authenticated using (
  user_id = auth.uid() or app.can(org_id, workspace_id, 'manage')
  or (workspace_id is not null and app.can(org_id, workspace_id, 'view'))
  or (workspace_id is null and app.is_org_member(org_id))
);
create policy memberships_insert on memberships for insert to authenticated with check (
  app.can(org_id, workspace_id, 'manage') and app.role_rank(role) <= app.my_rank(org_id, workspace_id));
create policy memberships_update on memberships for update to authenticated
  using (app.can(org_id, workspace_id, 'manage') and app.role_rank(role) <= app.my_rank(org_id, workspace_id))
  with check (app.can(org_id, workspace_id, 'manage') and app.role_rank(role) <= app.my_rank(org_id, workspace_id));
create policy memberships_delete on memberships for delete to authenticated using (
  app.can(org_id, workspace_id, 'manage') and app.role_rank(role) <= app.my_rank(org_id, workspace_id));

-- approvals: only roles with can_approve may decide, and only as themselves. Immutable.
alter table approvals enable row level security;
create policy approvals_select on approvals for select to authenticated using (app.can(org_id, workspace_id, 'view'));
create policy approvals_insert on approvals for insert to authenticated
  with check (app.can(org_id, workspace_id, 'approve') and decided_by = auth.uid());

-- publications: editors can draft; leaving draft requires can_publish.
alter table publication_jobs enable row level security;
create policy publication_jobs_select on publication_jobs for select to authenticated using (app.can(org_id, workspace_id, 'view'));
create policy publication_jobs_insert on publication_jobs for insert to authenticated with check (
  app.can(org_id, workspace_id, 'edit') and (status = 'draft' or app.can(org_id, workspace_id, 'publish')));
create policy publication_jobs_update on publication_jobs for update to authenticated
  using (app.can(org_id, workspace_id, 'edit'))
  with check (app.can(org_id, workspace_id, 'edit') and (status in ('draft', 'cancelled') or app.can(org_id, workspace_id, 'publish')));
create policy publication_jobs_delete on publication_jobs for delete to authenticated
  using (app.can(org_id, workspace_id, 'edit') and status = 'draft');

alter table publication_results enable row level security;
create policy publication_results_select on publication_results for select to authenticated using (app.can(org_id, workspace_id, 'view'));
create policy publication_results_insert on publication_results for insert to authenticated with check (
  app.can(org_id, workspace_id, 'publish') and confirmation = 'manual' and confirmed_by = auth.uid());

-- workflows: built-ins are readable by everyone; organizations manage their own overrides.
alter table workflows enable row level security;
create policy workflows_select on workflows for select to authenticated using (org_id is null or app.is_org_member(org_id));
create policy workflows_insert on workflows for insert to authenticated with check (org_id is not null and app.can(org_id, null, 'manage'));
create policy workflows_update on workflows for update to authenticated
  using (org_id is not null and app.can(org_id, null, 'manage')) with check (org_id is not null and app.can(org_id, null, 'manage'));
create policy workflows_delete on workflows for delete to authenticated using (org_id is not null and app.can(org_id, null, 'manage'));

-- templates: organization-shared (workspace_id null) or workspace-scoped.
alter table templates enable row level security;
create policy templates_select on templates for select to authenticated using (
  case when workspace_id is null then app.is_org_member(org_id) else app.can(org_id, workspace_id, 'view') end);
create policy templates_insert on templates for insert to authenticated with check (app.can(org_id, workspace_id, 'edit'));
create policy templates_update on templates for update to authenticated
  using (app.can(org_id, workspace_id, 'edit')) with check (app.can(org_id, workspace_id, 'edit'));
create policy templates_delete on templates for delete to authenticated using (app.can(org_id, workspace_id, 'edit'));

-- AI providers: visible to the organization, administered by managers.
alter table ai_providers enable row level security;
create policy ai_providers_select on ai_providers for select to authenticated using (app.is_org_member(org_id));
create policy ai_providers_insert on ai_providers for insert to authenticated with check (app.can(org_id, null, 'manage'));
create policy ai_providers_update on ai_providers for update to authenticated
  using (app.can(org_id, null, 'manage')) with check (app.can(org_id, null, 'manage'));
create policy ai_providers_delete on ai_providers for delete to authenticated using (app.can(org_id, null, 'manage'));

-- audit log: append-only; members write their own entries, managers read.
alter table audit_logs enable row level security;
create policy audit_logs_select on audit_logs for select to authenticated using (app.can(org_id, workspace_id, 'manage'));
create policy audit_logs_insert on audit_logs for insert to authenticated with check (
  app.is_org_member(org_id) and actor_id = auth.uid() and actor_kind = 'user');

-- Grants. (Supabase applies equivalent default privileges; explicit here so the
-- migrations behave identically on plain PostgreSQL.)
grant usage on schema public, app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
revoke all on all tables in schema public from anon;
insert into public.app_migrations (name) values ('0002_rls.sql');

-- ===== 0003_campaign_plan.sql =====
-- Campaign Studio: the generated plan lives on the campaign so every asset job can share it.
alter table campaigns add column strategy text;
alter table campaigns add column plan jsonb not null default '[]';   -- [{content_type, title, description, day_offset, job_id?}]
alter table campaigns add column plan_provider text;
insert into public.app_migrations (name) values ('0003_campaign_plan.sql');

-- ===== 0004_approval_trigger.sql =====
-- Recording an approval decision is what changes a job's status. Doing it in a trigger
-- means reviewers (who cannot edit content) can still approve, and a job can never be
-- "approved" without an approvals row naming who decided.
create function app.apply_approval() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select status into v_status from content_jobs where id = new.job_id for update;
  if v_status is distinct from 'awaiting_approval' then
    raise exception 'This content is not awaiting approval.' using errcode = 'P0001';
  end if;
  update content_jobs set
    status = new.decision,
    completed_at = case when new.decision in ('approved', 'rejected') then now() end,
    updated_at = now(),
    stages = (
      select coalesce(jsonb_agg(
        case when s ->> 'key' = 'human_approval' then
          s || jsonb_build_object(
            'status', case new.decision when 'approved' then 'done' when 'rejected' then 'failed' else 'pending' end,
            'finished_at', now(),
            'note', coalesce(new.comment, ''))
        else s end order by ord), '[]'::jsonb)
      from jsonb_array_elements(stages) with ordinality as t(s, ord))
  where id = new.job_id;
  return new;
end $$;

create trigger approvals_apply before insert on approvals
  for each row execute function app.apply_approval();
insert into public.app_migrations (name) values ('0004_approval_trigger.sql');
commit;
