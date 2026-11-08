import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deleteTable } from "../lib/db.js";
import { uploadCsv } from "../lib/csv.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const tablePrefix = "qr_11111111111141118111111111111111_";
const fullTableName = `${tablePrefix}sales`;
const uiSource = readFileSync(new URL("../app/queryra-app.jsx", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/SQG/content/v1/[...path]/route.js", import.meta.url), "utf8");

function deletionDependencies({ tables = [fullTableName], dropError } = {}) {
  const calls = [];
  let currentTables = [...tables];
  let released = false;
  const client = {
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("DROP TABLE") && dropError) throw dropError;
      if (sql.startsWith("DROP TABLE")) currentTables = currentTables.filter((name) => name !== fullTableName);
      return { rows: [] };
    },
    release() { released = true; },
  };
  return {
    calls,
    wasReleased: () => released,
    async getTables(id) { assert.equal(id, workspaceId); return [...currentTables]; },
    async getSchema(names, id) { assert.equal(id, workspaceId); return names.map((name) => `CREATE TABLE ${name};`).join("\n"); },
    async assertRole(role) { assert.equal(role, "admin"); },
    getDbPool(role) { assert.equal(role, "admin"); return { connect: async () => client }; },
  };
}

test("deletes an existing workspace table and returns refreshed tables and schema", async () => {
  const dependencies = deletionDependencies();
  const result = await deleteTable(fullTableName, workspaceId, dependencies);

  assert.equal(result.deletedTable, fullTableName);
  assert.deepEqual(result.tables, []);
  assert.equal(result.schema_text, "");
  assert.deepEqual(dependencies.calls, [`DROP TABLE public."${fullTableName}"`]);
  assert.equal(dependencies.wasReleased(), true);
});

test("reports a permission failure without dropping or hiding the table", async () => {
  const dependencies = deletionDependencies({ dropError: Object.assign(new Error("permission denied"), { code: "42501" }) });

  await assert.rejects(
    deleteTable(fullTableName, workspaceId, dependencies),
    (error) => error.status === 503 && error.code === "DATABASE_ROLE_UNSAFE" && /does not own this workspace table/.test(error.message),
  );
  assert.equal(dependencies.wasReleased(), true);
  assert.deepEqual(await dependencies.getTables(workspaceId), [fullTableName]);
});

test("returns not found for nonexistent and other-workspace tables without executing DROP", async () => {
  const absent = deletionDependencies({ tables: [] });
  await assert.rejects(deleteTable("missing", workspaceId, absent), (error) => error.status === 404 && error.code === "TABLE_NOT_FOUND");

  const otherWorkspaceTable = "qr_22222222222242228222222222222222_sales";
  const outside = deletionDependencies({ tables: [] });
  await assert.rejects(deleteTable(otherWorkspaceTable, workspaceId, outside), (error) => error.status === 404 && error.code === "TABLE_NOT_FOUND");
  assert.deepEqual(absent.calls, []);
  assert.deepEqual(outside.calls, []);
});

test("rejects invalid table identifiers before database access", async () => {
  const dependencies = deletionDependencies();

  for (const name of ['sales"; DROP TABLE public.users;--', "pg_catalog.pg_roles"]) {
    await assert.rejects(
      deleteTable(name, workspaceId, dependencies),
      (error) => error.status === 400 && error.code === "INVALID_TABLE_NAME",
    );
  }
  assert.deepEqual(dependencies.calls, []);
});

test("the confirmation handler posts the delete request and refreshes UI state only after success", () => {
  const start = uiSource.indexOf("async function handleDeleteTable(tableName)");
  const end = uiSource.indexOf("/* ============================\n     FILE HANDLING", start);
  const handler = uiSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(routeSource, /if \(endpoint === "delete-table"\)[\s\S]*?\(\) => deleteTable\(input\.tableName, workspaceId\)/);
  assert.ok(handler.indexOf('apiPost("/delete-table"') < handler.indexOf("setAvailableTables(res.tables || [])"));
  assert.ok(handler.indexOf("setAvailableTables(res.tables || [])") < handler.indexOf("setTableToDelete(null)"));
  assert.match(handler, /catch \(err\) \{\s*setError\(err\.message \|\| "Failed to remove table\."\);/);
});

test("table loading keeps the database list when schema inspection fails", () => {
  const start = uiSource.indexOf("async function loadWorkspaceTables()");
  const end = uiSource.indexOf("/* ============================\n     INITIAL LOAD", start);
  const loader = uiSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(loader, /const data = await apiGet\("\/tables"\);\s*setAvailableTables\(data\.tables \|\| \[\]\);/);
  assert.match(loader, /catch \{\s*setTableListError\("Workspace tables could not be loaded/);
  assert.match(loader, /const schemaData = await apiGet\("\/schema"\);[\s\S]*?catch \{[\s\S]*?setSchema\(""\);/);
  assert.doesNotMatch(loader, /catch \{\s*setAvailableTables\(\[\]\)/);
});

test("workspace tables are visible below upload with an explicit delete action and pending file removal label", () => {
  const upload = uiSource.indexOf("{/* Ingestion Dropzone Card */}");
  const tables = uiSource.indexOf("{/* Active Workspace Tables & Schema Inspector */}");
  const processing = uiSource.indexOf("{/* Processing Engine Card */}");
  const panel = uiSource.slice(tables, processing);

  assert.ok(upload >= 0 && tables > upload && processing > tables);
  assert.match(panel, /No uploaded tables in this workspace yet\./);
  assert.match(panel, /Delete table \$\{cleanName\}/);
  assert.match(panel, />\s*Delete\s*</);
  assert.match(uiSource, /Remove pending file/);
});

test("a deleted upload name can be uploaded again and appears in the refreshed workspace list", async () => {
  const tables = [];
  const client = {
    async query(sql) {
      const create = sql.match(/^CREATE TABLE public\."([^"]+)"/);
      const drop = sql.match(/^DROP TABLE public\."([^"]+)"/);
      if (create) tables.push(create[1]);
      if (drop) tables.splice(tables.indexOf(drop[1]), 1);
      return { rows: [] };
    },
    release() {},
  };
  const getTables = async (id) => {
    assert.equal(id, workspaceId);
    return [...tables];
  };
  const getDbPool = (role) => {
    assert.equal(role, "admin");
    return { connect: async () => client };
  };
  const file = {
    name: "sales.csv",
    type: "text/csv",
    size: 5,
    async arrayBuffer() { return Buffer.from("id\n1\n"); },
  };
  const uploadDependencies = {
    assertRole: async () => {},
    getDbPool,
    getRoleName: async (role) => { assert.equal(role, "reader"); return "queryra_reader"; },
    getTables,
  };
  const firstUpload = await uploadCsv(file, "sales", workspaceId, uploadDependencies);
  assert.deepEqual(await getTables(workspaceId), [firstUpload.table_name]);

  const deleted = await deleteTable(firstUpload.table_name, workspaceId, {
    assertRole: async () => {},
    getDbPool,
    getTables,
    getSchema: async () => "",
  });
  assert.deepEqual(deleted.tables, []);

  const secondUpload = await uploadCsv(file, "sales", workspaceId, uploadDependencies);
  assert.equal(secondUpload.table_name, firstUpload.table_name);
  assert.deepEqual(secondUpload.tables, [firstUpload.table_name]);
});
