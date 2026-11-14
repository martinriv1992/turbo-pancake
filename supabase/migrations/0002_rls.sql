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
