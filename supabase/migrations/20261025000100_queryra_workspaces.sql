-- Apply manually to a fresh project only after reviewing the migration and
-- provisioning restricted PostgreSQL roles described in docs/database-access.md.
-- This migration does not touch the historical trial tables.
begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table if not exists public.workspaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id, created_at);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create or replace function app_private.user_workspace_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select wm.workspace_id
  from public.workspace_members as wm
  where wm.user_id = (select auth.uid());
$$;
revoke all on function app_private.user_workspace_ids() from public, anon;
grant execute on function app_private.user_workspace_ids() to authenticated;

drop policy if exists workspace_members_read_self on public.workspace_members;
create policy workspace_members_read_self on public.workspace_members
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists workspaces_read_member on public.workspaces;
create policy workspaces_read_member on public.workspaces
  for select to authenticated
  using (id in (select app_private.user_workspace_ids()));

grant select on public.workspaces, public.workspace_members to authenticated;
revoke all on public.workspaces, public.workspace_members from anon;

create or replace function app_private.create_workspace(workspace_name text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  clean_name text := pg_catalog.btrim(workspace_name);
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(auth.uid()::text)::bigint);
  select wm.workspace_id into new_workspace_id
    from public.workspace_members as wm
    where wm.user_id = auth.uid()
    order by wm.created_at, wm.workspace_id
    limit 1;
  if found then return new_workspace_id; end if;
  if clean_name is null or pg_catalog.length(clean_name) < 1 or pg_catalog.length(clean_name) > 120 then
    raise exception 'invalid workspace name' using errcode = '22023';
  end if;
  insert into public.workspaces(name) values (clean_name) returning id into new_workspace_id;
  insert into public.workspace_members(workspace_id, user_id, role)
    values (new_workspace_id, auth.uid(), 'owner');
  return new_workspace_id;
end;
$$;
revoke all on function app_private.create_workspace(text) from public, anon;
grant execute on function app_private.create_workspace(text) to authenticated;

-- Supabase RPC only exposes public functions. This wrapper delegates to the
-- private function, which performs its own authenticated identity check.
create or replace function public.create_workspace(workspace_name text)
returns uuid
language sql security invoker
set search_path = ''
as $$ select app_private.create_workspace(workspace_name); $$;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

-- Queryra CSV tables are created in public with this naming convention:
-- qr_<32-hex-character-workspace-id>_<sanitized-table-name>. Each table has a
-- non-null workspace_id column, ENABLE + FORCE ROW LEVEL SECURITY, and a
-- workspace_isolation policy using the transaction-local app.workspace_id.
-- The app sets this context only after verifying Auth membership server-side.
-- Reader/ingestion connection credentials must be different, non-superuser
-- roles without BYPASSRLS; configure reader access/default privileges manually.
commit;
