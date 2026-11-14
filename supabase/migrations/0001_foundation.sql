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
