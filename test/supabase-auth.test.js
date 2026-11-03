import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSupabasePublicConfig } from "../lib/supabase/env.js";
import { resolveWorkspaceId, verifiedSubject } from "../lib/supabase/auth-core.js";
import { isReadOnlyReaderRole, isRlsRestrictedRole, isSafeIngestionRole, resolveDatabaseUrl } from "../lib/db.js";
import { resolveSchema } from "../lib/sql.js";
import { workspaceTableName } from "../lib/csv.js";

test("public Supabase configuration requires a URL and publishable key without accepting HTTP origins", () => {
  assert.throws(() => getSupabasePublicConfig({}), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.throws(() => getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "http://example.com", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key" }), /HTTPS/);
  assert.deepEqual(getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://queryra-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" }), {
    url: "https://queryra-test.supabase.co", key: "sb_publishable_test",
  });
});

test("default public config reads Next.js statically inlined variables", () => {
  const envPath = new URL("../lib/supabase/env.js", import.meta.url);
  const source = readFileSync(envPath, "utf8");
  assert.match(source, /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(source, /process\.env\.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);

  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://queryra-test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    assert.deepEqual(getSupabasePublicConfig(), {
      url: "https://queryra-test.supabase.co",
      key: "sb_publishable_test",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test("server identity requires verified claims and rejects missing or invalid sessions", async () => {
  assert.equal(await verifiedSubject({ auth: { getClaims: async () => ({ data: { claims: { sub: "verified-user" } }, error: null }) } }), "verified-user");
  await assert.rejects(verifiedSubject({ auth: { getClaims: async () => ({ data: { claims: null }, error: { message: "invalid" } }) } }), (error) => error.status === 401 && error.code === "UNAUTHENTICATED");
  await assert.rejects(verifiedSubject({ auth: { getClaims: async () => ({ data: null, error: { name: "AuthRetryableFetchError", status: 0 } }) } }), (error) => error.status === 503 && error.code === "AUTH_UNAVAILABLE");
});

test("workspace selection uses membership RLS and creates ownership through the server RPC", async () => {
  let rpcName;
  const noMembership = {
    from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
    rpc: async (name, args) => { rpcName = [name, args.workspace_name]; return { data: "11111111-1111-4111-8111-111111111111", error: null }; },
  };
  assert.equal(await resolveWorkspaceId(noMembership), "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(rpcName, ["create_workspace", "My Workspace"]);

  const membership = { from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { workspace_id: "22222222-2222-4222-8222-222222222222" }, error: null }) }) }) }) }) };
  assert.equal(await resolveWorkspaceId(membership), "22222222-2222-4222-8222-222222222222");
});

test("hosted/local database targets select only their explicit credential variables", () => {
  assert.equal(resolveDatabaseUrl("reader", { DATABASE_TARGET: "local", DATABASE_LOCAL_READER_URL: "postgresql://local-reader@127.0.0.1:5432/queryra", DATABASE_URL: "postgresql://local-owner@127.0.0.1:5432/queryra", DATABASE_READER_URL: "postgresql://hosted-reader@db.example:5432/postgres" }), "postgresql://local-reader@127.0.0.1:5432/queryra");
  assert.equal(resolveDatabaseUrl("reader", { DATABASE_TARGET: "hosted", DATABASE_URL: "postgresql://local-owner@127.0.0.1:5432/queryra", DATABASE_READER_URL: "postgresql://hosted-reader@db.example:5432/postgres" }), "postgresql://hosted-reader@db.example:5432/postgres");
  assert.throws(() => resolveDatabaseUrl("reader", { DATABASE_TARGET: "hosted", DATABASE_URL: "postgresql://local-owner@127.0.0.1:5432/queryra" }), (error) => error.status === 503 && error.code === "DATABASE_CONFIGURATION");
  assert.throws(() => resolveDatabaseUrl("reader", { DATABASE_TARGET: "local", DATABASE_URL: "postgresql://local-owner@127.0.0.1:5432/queryra" }), (error) => error.status === 503 && error.code === "DATABASE_CONFIGURATION");
  assert.throws(() => resolveDatabaseUrl("reader", { DATABASE_TARGET: "local", DATABASE_LOCAL_READER_URL: "not-a-url" }), /malformed/);
  assert.throws(() => resolveDatabaseUrl("reader", { DATABASE_TARGET: "local", DATABASE_LOCAL_READER_URL: "postgresql://hosted-user@db.project.supabase.co:5432/postgres" }), (error) => error.code === "DATABASE_TARGET_MISMATCH");
});

test("database role checks fail closed for superusers, bypass roles and missing role metadata", () => {
  assert.equal(isRlsRestrictedRole([{ rolsuper: false, rolbypassrls: false, inherited_bypass: false }]), true);
  assert.equal(isRlsRestrictedRole([{ rolsuper: true, rolbypassrls: false, inherited_bypass: false }]), false);
  assert.equal(isRlsRestrictedRole([{ rolsuper: false, rolbypassrls: true, inherited_bypass: true }]), false);
  assert.equal(isRlsRestrictedRole([]), false);
});

test("reader role checks require read-only defaults and no public write privileges", () => {
  const safeReader = [{ rolsuper: false, rolbypassrls: false, rolinherit: false, inherited_bypass: false, default_read_only: "on", role_memberships: false, public_create: false, public_write_privileges: false, public_sequence_write_privileges: false }];
  assert.equal(isReadOnlyReaderRole(safeReader), true);
  assert.equal(isReadOnlyReaderRole([{ ...safeReader[0], public_write_privileges: true }]), false);
  assert.equal(isReadOnlyReaderRole([{ ...safeReader[0], default_read_only: "off" }]), false);
  assert.equal(isReadOnlyReaderRole([{ ...safeReader[0], role_memberships: true }]), false);
});

test("ingestion role checks reject inherited privileges and role memberships", () => {
  const safeIngest = [{ rolsuper: false, rolbypassrls: false, rolinherit: false, inherited_bypass: false, role_memberships: false }];
  assert.equal(isSafeIngestionRole(safeIngest), true);
  assert.equal(isSafeIngestionRole([{ ...safeIngest[0], rolinherit: true }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngest[0], role_memberships: true }]), false);
  assert.equal(isSafeIngestionRole([{ ...safeIngest[0], inherited_bypass: true }]), false);
});

test("dynamic schema resolution accepts workspace datasets and reports an empty workspace clearly", async () => {
  const workspaceId = "11111111-1111-4111-8111-111111111111";
  const table = "qr_11111111111141118111111111111111_sales";
  const schemaText = `CREATE TABLE ${table} (amount numeric);`;
  assert.equal(await resolveSchema({ schemaMode: "default" }, workspaceId, {
    getSchema: async (tables, id) => { assert.equal(tables, undefined); assert.equal(id, workspaceId); return schemaText; },
  }), schemaText);
  await assert.rejects(resolveSchema({ schemaMode: "default" }, workspaceId, {
    getSchema: async () => "",
  }), (error) => error.status === 409 && error.code === "NO_DATASETS");
  await assert.rejects(resolveSchema({ schemaMode: "selected_tables", selectedTables: ["wallpaper_transactions"] }, workspaceId, {
    getTables: async () => [table],
  }), (error) => error.status === 400 && error.code === "INVALID_RELATION");
});

test("workspace database lookup fails closed when membership metadata is unavailable", async () => {
  const broken = { from: () => ({ select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: { code: "42P01" } }) }) }) }) }) };
  await assert.rejects(resolveWorkspaceId(broken), (error) => error.status === 503 && error.code === "WORKSPACE_CONFIGURATION");
});

test("workspace upload tables are separated by the complete UUID and fit PostgreSQL identifiers", () => {
  const first = workspaceTableName("11111111-1111-4111-8111-111111111111", "a".repeat(100));
  const second = workspaceTableName("22222222-2222-4222-8222-222222222222", "a".repeat(100));
  assert.notEqual(first.table, second.table);
  assert.ok(first.table.length <= 63);
  assert.match(first.table, /^qr_11111111111141118111111111111111_/);
  assert.throws(() => workspaceTableName("not-a-uuid", "data"), (error) => error.status === 401);
});
