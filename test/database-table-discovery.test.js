import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ensureWorkspaceReaderAccess, getWorkspaceSchemaMetadata, getWorkspaceTableNames } from "../lib/db.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const prefix = "qr_11111111111141118111111111111111_";
const routeSource = readFileSync(new URL("../app/SQG/content/v1/[...path]/route.js", import.meta.url), "utf8");
const csvSource = readFileSync(new URL("../lib/csv.js", import.meta.url), "utf8");
const dbSource = readFileSync(new URL("../lib/db.js", import.meta.url), "utf8");

test("workspace table discovery uses the ingestion connection and filters the authenticated workspace prefix", async () => {
  let query;
  const tables = await getWorkspaceTableNames(workspaceId, {
    async assertRole(role) { assert.equal(role, "admin"); },
    getDbPool(role) {
      assert.equal(role, "admin");
      return { async query(sql, values) { query = { sql, values }; return { rows: [{ table_name: `${prefix}sales` }] }; } };
    },
  });

  assert.deepEqual(tables, [`${prefix}sales`]);
  assert.deepEqual(query.values, [prefix]);
  assert.match(query.sql, /pg_catalog\.pg_class/);
  assert.match(query.sql, /c\.relkind IN \('r', 'p'\)/);
  assert.doesNotMatch(query.sql, /information_schema/);
});

test("reader access is granted only on ingestion-owned workspace tables that have forced RLS", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("SELECT c.relname")) return { rows: [{ table_name: `${prefix}sales` }] };
      return { rows: [] };
    },
    release() { calls.push({ release: true }); },
  };

  await ensureWorkspaceReaderAccess(workspaceId, {
    tableNames: [`${prefix}sales`],
    async assertRole(role) { calls.push({ role }); },
    async getRoleName(role) { assert.equal(role, "reader"); return "queryra_reader"; },
    getDbPool(role) {
      assert.equal(role, "admin");
      return { connect: async () => client };
    },
  });

  assert.deepEqual(calls.filter((call) => call.role).map((call) => call.role), ["reader", "admin"]);
  const ownershipCheck = calls.find((call) => call.sql?.includes("SELECT c.relname"));
  assert.match(ownershipCheck.sql, /relrowsecurity AND c\.relforcerowsecurity/);
  assert.match(ownershipCheck.sql, /c\.relowner =/);
  assert.match(ownershipCheck.sql, /NOT has_table_privilege/);
  assert.deepEqual(ownershipCheck.values, [[`${prefix}sales`], prefix, "queryra_reader"]);
  assert.ok(calls.some((call) => call.sql === `GRANT SELECT ON TABLE public."${prefix}sales" TO "queryra_reader"`));
  assert.equal(calls.at(-1).release, true);
});

test("workspace schema discovery uses the ingestion role while query authorization stays on the reader list", async () => {
  const calls = [];
  const schema = await getWorkspaceSchemaMetadata([`${prefix}sales`], workspaceId, {
    async assertRole(role) { calls.push(`role:${role}`); },
    getDbPool(role) {
      calls.push(`pool:${role}`);
      return { async query(sql, values) {
        assert.match(sql, /information_schema\.columns/);
        assert.deepEqual(values, [[`${prefix}sales`]]);
        return { rows: [{ table_name: `${prefix}sales`, column_name: "amount", data_type: "integer", is_nullable: "YES", is_primary: false }] };
      } };
    },
  });

  assert.deepEqual(calls, ["role:admin", "pool:admin"]);
  assert.match(schema, new RegExp(`CREATE TABLE ${prefix}sales`));
  assert.match(routeSource, /endpoint === "tables"[\s\S]*?getWorkspaceTableNames\(workspaceId\)/);
  assert.match(routeSource, /endpoint === "schema"[\s\S]*?getWorkspaceSchemaMetadata\(undefined, workspaceId\)/);
  assert.match(routeSource, /endpoint === "generate-sql"[\s\S]*?ensureWorkspaceReaderAccess\(workspaceId\)/);
  assert.match(csvSource, /getTables = getWorkspaceTableNames/);
  assert.match(dbSource, /export async function getSchemaMetadata\(tableNames, workspaceId\)[\s\S]*?schemaMetadataForTables\(names, "reader"\)/);
  assert.match(dbSource, /export async function deleteTable\([\s\S]*?getTables = getWorkspaceTableNames/);
});
