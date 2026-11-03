import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveWorkspaceId } from "../lib/supabase/auth-core.js";

const migration = readFileSync(new URL("../supabase/migrations/20261025000100_queryra_workspaces.sql", import.meta.url), "utf8");
const authCore = readFileSync(new URL("../lib/supabase/auth-core.js", import.meta.url), "utf8");

test("workspace migration matches membership lookup and workspace bootstrap callers", () => {
  assert.match(migration, /create table if not exists public\.workspace_members\s*\([\s\S]*?workspace_id uuid not null[\s\S]*?user_id uuid not null[\s\S]*?role text not null[\s\S]*?created_at timestamptz not null/i);
  assert.match(authCore, /from\("workspace_members"\)\.select\("workspace_id"\)[\s\S]*?order\("created_at"/);
  assert.match(migration, /create or replace function public\.create_workspace\(workspace_name text\)\s*returns uuid/i);
  assert.match(authCore, /rpc\("create_workspace",\s*\{\s*workspace_name:/);
  assert.match(migration, /if auth\.uid\(\) is null then raise exception/i);
  assert.match(migration, /where wm\.user_id = auth\.uid\(\)/i);
});

test("workspace migration protects metadata with per-user and member RLS policies", () => {
  assert.match(migration, /alter table public\.workspaces enable row level security/i);
  assert.match(migration, /alter table public\.workspace_members enable row level security/i);
  assert.match(migration, /for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/i);
  assert.match(migration, /for select to authenticated\s+using \(id in \(select app_private\.user_workspace_ids\(\)\)\)/i);
  assert.match(migration, /revoke all on public\.workspaces, public\.workspace_members from anon/i);
  assert.match(migration, /grant select on public\.workspaces, public\.workspace_members to authenticated/i);
});

test("security definer functions pin search_path and no destructive demo-table migration exists", () => {
  assert.equal((migration.match(/security definer\s+set search_path = ''/gi) || []).length, 2);
  assert.match(migration, /revoke all on function app_private\.user_workspace_ids\(\) from public, anon/i);
  assert.match(migration, /revoke all on function app_private\.create_workspace\(text\) from public, anon/i);
  assert.doesNotMatch(migration, /\b(drop\s+(?:table|schema)|truncate|delete\s+from)\b/i);
  assert.doesNotMatch(migration, /uploaded_table|wallpaper_transactions|wallpaper\.csv/i);
});

test("workspace bootstrap returns the authenticated user's membership or a server-owned RPC result", async () => {
  let rpcArgs;
  const supabase = {
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    rpc: async (name, args) => { rpcArgs = [name, args]; return { data: "11111111-1111-4111-8111-111111111111", error: null }; },
  };
  assert.equal(await resolveWorkspaceId(supabase), "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(rpcArgs, ["create_workspace", { workspace_name: "My Workspace" }]);
});
