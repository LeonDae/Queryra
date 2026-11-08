import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uploadCsv, workspaceTableName } from "../lib/csv.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const uploadUi = readFileSync(new URL("../app/queryra-app.jsx", import.meta.url), "utf8");
const uploadRoute = readFileSync(new URL("../app/SQG/content/v1/[...path]/route.js", import.meta.url), "utf8");

function csvFile(content, { name = "sales.csv", type = "text/csv", reportedSize } = {}) {
  const bytes = Buffer.from(content);
  return {
    name,
    type,
    size: reportedSize ?? bytes.byteLength,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
}

function fakeDatabase({ insertError, createError } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("INSERT") && insertError) throw insertError;
      if (sql.startsWith("CREATE TABLE") && createError) throw createError;
      return { rows: [] };
    },
    release() { released = true; },
  };
  return {
    calls,
    client,
    wasReleased: () => released,
    async getRoleName(role) { assert.equal(role, "reader"); return "queryra_reader"; },
    getDbPool(role) {
      assert.equal(role, "admin");
      return { connect: async () => client };
    },
  };
}

test("CSV upload creates a workspace table transactionally and returns dataset/schema details", async () => {
  const db = fakeDatabase();
  const roles = [];
  const result = await uploadCsv(
    csvFile('Item name,amount,workspace_id,note\n"hello, world",12.5,ignored,"two\nlines"\n'),
    "My report; DROP TABLE",
    workspaceId,
    {
      assertRole: async (role) => roles.push(role),
      getDbPool: db.getDbPool,
      getRoleName: db.getRoleName,
      getTables: async (id) => { assert.equal(id, workspaceId); return []; },
    },
  );

  const physicalTable = workspaceTableName(workspaceId, "My report; DROP TABLE").table;
  assert.deepEqual(roles, ["reader", "admin"]);
  assert.equal(result.dataset.id, physicalTable);
  assert.equal(result.dataset.name, "my_report_drop_table");
  assert.equal(result.dataset.row_count, 1);
  assert.deepEqual(result.columns, ["item_name", "amount", "source_workspace_id", "note"]);
  assert.deepEqual(result.tables, [physicalTable]);
  assert.match(result.schema_text, new RegExp(`CREATE TABLE ${physicalTable}`));
  assert.ok(db.calls.some(({ sql }) => sql === "BEGIN"));
  assert.ok(db.calls.some(({ sql }) => sql.includes("ENABLE ROW LEVEL SECURITY")));
  assert.ok(db.calls.some(({ sql }) => sql.includes("FORCE ROW LEVEL SECURITY")));
  assert.ok(db.calls.some(({ sql }) => sql === `GRANT SELECT ON TABLE public."${physicalTable}" TO "queryra_reader"`));
  assert.ok(db.calls.some(({ sql }) => sql.startsWith("INSERT INTO")));
  const insert = db.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
  assert.deepEqual(insert.values, [workspaceId, "hello, world", "12.5", "ignored", "two\nlines"]);
  assert.ok(db.calls.some(({ sql }) => sql === "COMMIT"));
  assert.equal(db.wasReleased(), true);
});

test("CSV uploads can complete consecutively and refresh the returned table list", async () => {
  const db = fakeDatabase();
  const tables = [];
  const upload = (name, id) => uploadCsv(csvFile(`id,name\n${id},row_${id}\n`), name, workspaceId, {
    assertRole: async () => {},
    getDbPool: db.getDbPool,
    getRoleName: db.getRoleName,
    getTables: async (idFromRequest) => { assert.equal(idFromRequest, workspaceId); return [...tables]; },
  });

  const first = await upload("first", 1);
  tables.push(first.table_name);
  const second = await upload("second", 2);
  tables.push(second.table_name);

  assert.equal(first.inserted_rows, 1);
  assert.equal(second.inserted_rows, 1);
  assert.deepEqual(second.tables, [first.table_name, second.table_name].sort());
  assert.equal(db.calls.filter(({ sql }) => sql.startsWith("INSERT INTO")).length, 2);
});

test("CSV uploads without an explicit table name use the uploaded filename", async () => {
  const db = fakeDatabase();
  const result = await uploadCsv(csvFile("id\n1\n", { name: "customers_160.csv" }), undefined, workspaceId, {
    assertRole: async () => {},
    getDbPool: db.getDbPool,
    getRoleName: db.getRoleName,
    getTables: async () => [],
  });

  assert.equal(result.dataset.name, "customers_160");
  assert.equal(result.table_name, workspaceTableName(workspaceId, "customers_160").table);
});

test("CREATE TABLE and parameterized INSERT share the source-to-database header mapping", async () => {
  const db = fakeDatabase();
  const result = await uploadCsv(
    csvFile(',Order Name,Order Name,Amount ($),候補,workspace_id,source_workspace_id\n,first,duplicate,,東京,source_id,existing_id'),
    "headers",
    workspaceId,
    { assertRole: async () => {}, getDbPool: db.getDbPool, getRoleName: db.getRoleName, getTables: async () => [] },
  );

  const create = db.calls.find(({ sql }) => sql.startsWith("CREATE TABLE")).sql;
  const insert = db.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
  const createColumns = [...create.matchAll(/"([a-z_][a-z0-9_]*)" (?:text|integer|double precision|boolean|date|timestamp|bigint|numeric)/g)].map(([, name]) => name);
  const insertColumns = [...insert.sql.match(/\(workspace_id, ([^)]+)\)/)[1].matchAll(/"([a-z_][a-z0-9_]*)"/g)].map(([, name]) => name);

  assert.deepEqual(result.columns, ["column_1", "order_name", "order_name_2", "amount", "column_5", "source_workspace_id", "source_workspace_id_2"]);
  assert.deepEqual(createColumns, result.columns);
  assert.deepEqual(insertColumns, createColumns);
  assert.deepEqual(insert.values, [workspaceId, null, "first", "duplicate", null, "東京", "source_id", "existing_id"]);
  assert.equal(result.inserted_rows, 1);
});

test("CSV insertion splits large datasets into batches without losing rows", async () => {
  const db = fakeDatabase();
  const rows = Array.from({ length: 501 }, (_, index) => `${index + 1},row_${index + 1}`).join("\n");
  const result = await uploadCsv(csvFile(`id,note\n${rows}`), "batched", workspaceId, {
    assertRole: async () => {}, getDbPool: db.getDbPool, getRoleName: db.getRoleName, getTables: async () => [],
  });
  const inserts = db.calls.filter(({ sql }) => sql.startsWith("INSERT INTO"));

  assert.equal(result.inserted_rows, 501);
  assert.equal(inserts.length, 2);
  assert.equal(inserts.reduce((total, insert) => total + insert.values.length / 3, 0), 501);
  assert.deepEqual(inserts[1].values, [workspaceId, "501", "row_501"]);
});

test("CSV upload rejects an existing workspace table before using ingestion role", async () => {
  const table = workspaceTableName(workspaceId, "sales").table;
  let roleChecked = false;
  await assert.rejects(
    uploadCsv(csvFile("id\n1\n"), "sales", workspaceId, {
      assertRole: async () => { roleChecked = true; },
      getTables: async () => [table],
    }),
    (error) => error.status === 409 && error.code === "DATASET_ALREADY_EXISTS",
  );
  assert.equal(roleChecked, false);
});

test("CSV upload rejects missing files and missing or invalid workspace authorization", async () => {
  await assert.rejects(uploadCsv(null, "sales", workspaceId), (error) => error.status === 400 && error.code === "INVALID_FILE_TYPE");
  const file = csvFile("id\n1\n");
  await assert.rejects(uploadCsv(file, "sales", null), (error) => error.status === 401 && error.code === "WORKSPACE_REQUIRED");
  await assert.rejects(uploadCsv(file, "sales", "not-a-workspace-id"), (error) => error.status === 401 && error.code === "WORKSPACE_REQUIRED");
});

test("CSV upload rolls back failed inserts and releases the client", async () => {
  const db = fakeDatabase({ insertError: Object.assign(new Error("invalid date"), { code: "22008" }) });
  await assert.rejects(
    uploadCsv(csvFile("date\n2023-02-29\n"), "sales", workspaceId, {
      assertRole: async () => {}, getDbPool: db.getDbPool, getRoleName: db.getRoleName, getTables: async () => [],
    }),
    (error) => error.status === 400 && error.code === "CSV_INVALID_DATA",
  );
  assert.ok(db.calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!db.calls.some(({ sql }) => sql === "COMMIT"));
  assert.equal(db.wasReleased(), true);
});

test("concurrent duplicate-name collision returns conflict without overwriting", async () => {
  const db = fakeDatabase({ createError: Object.assign(new Error("already exists"), { code: "42P07" }) });
  await assert.rejects(
    uploadCsv(csvFile("id\n1\n"), "sales", workspaceId, {
      assertRole: async () => {}, getDbPool: db.getDbPool, getRoleName: db.getRoleName, getTables: async () => [],
    }),
    (error) => error.status === 409 && error.code === "DATASET_ALREADY_EXISTS",
  );
  assert.ok(db.calls.some(({ sql }) => sql === "ROLLBACK"));
  assert.ok(!db.calls.some(({ sql }) => sql === "COMMIT"));
});

test("CSV upload validates extension, declared MIME type, and actual payload size", async () => {
  await assert.rejects(uploadCsv(csvFile("id\n1\n", { name: "sales.txt" }), "sales", workspaceId), (error) => error.code === "INVALID_FILE_TYPE");
  await assert.rejects(uploadCsv(csvFile("id\n1\n", { type: "application/octet-stream" }), "sales", workspaceId), (error) => error.code === "INVALID_FILE_TYPE");
  await assert.rejects(uploadCsv(csvFile("\n".padEnd(10 * 1024 * 1024 + 1, "x"), { reportedSize: 1 }), "sales", workspaceId), (error) => error.status === 413 && error.code === "UPLOAD_TOO_LARGE");
});

test("CSV upload rejects invalid UTF-8 instead of silently replacing bytes", async () => {
  const bytes = Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xc3, 0x28]);
  const file = { name: "bad.csv", type: "text/csv", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  await assert.rejects(uploadCsv(file, "bad", workspaceId), (error) => error.status === 400 && error.code === "INVALID_CSV_ENCODING");
});

test("CSV upload maps ingestion credential failures without exposing connection details", async () => {
  await assert.rejects(
    uploadCsv(csvFile("id\n1\n"), "sales", workspaceId, {
      assertRole: async () => {},
      getRoleName: async (role) => { assert.equal(role, "reader"); return "queryra_reader"; },
      getTables: async () => [],
      getDbPool: () => ({ connect: async () => { throw Object.assign(new Error("password authentication failed for user"), { code: "28P01" }); } }),
    }),
    (error) => error.status === 503 && error.code === "DATABASE_AUTHENTICATION_FAILED" && !error.message.includes("password"),
  );
});

test("browser upload uses the selected File and the API's multipart field without setting Content-Type", () => {
  assert.match(uploadUi, /const API_BASE = '\/SQG\/content\/v1'/);
  assert.match(uploadUi, /fetch\(`\$\{API_BASE\}\$\{path\}`/);
  assert.match(uploadUi, /ref=\{csvFileInputRef\}[\s\S]*?type="file"[\s\S]*?onChange=\{\(e\)\s*=>\s*\{[\s\S]*?setCsvFile\(selectedFile\)/);
  assert.match(uploadUi, /formData\.append\('file',\s*csvFile\)/);
  assert.match(uploadUi, /formData\.append\('table_name',\s*csvTableName\.trim\(\)\)/);
  assert.match(uploadUi, /csvFileInputRef\.current\?\.click\(\)/);
  assert.match(uploadUi, /setCsvUploadResult\(res\)/);
  assert.match(uploadUi, /csvUploadResult\.dataset\?\.name[\s\S]*?csvUploadResult\.inserted_rows[\s\S]*?csvUploadResult\.columns/);
  assert.match(uploadUi, /disabled=\{loading \|\| csvUploading\}[\s\S]*?csvUploading \? 'Uploading\.\.\.' : 'Upload CSV & Create Table'/);
  assert.match(uploadUi, /if \(csvUploadInFlightRef\.current\) return[\s\S]*?csvUploadInFlightRef\.current = true[\s\S]*?finally \{[\s\S]*?csvUploadInFlightRef\.current = false/);
  const uploadHandlerStart = uploadUi.indexOf("async function handleUploadAndIndex()");
  const uploadHandlerEnd = uploadUi.indexOf("/* ============================\n     SQL GENERATION", uploadHandlerStart);
  const uploadHandler = uploadUi.slice(uploadHandlerStart, uploadHandlerEnd);
  const uploadCatch = uploadHandler.slice(uploadHandler.indexOf("} catch (err) {"), uploadHandler.indexOf("} finally {"));
  assert.match(uploadCatch, /setError\(err\.message \|\| "Dataset ingestion failed\."\)/);
  assert.doesNotMatch(uploadCatch, /setCsvFile\(null\)|setCsvTableName\(""\)/);
  assert.match(uploadRoute, /consumeRateLimit\(`csv-upload:\$\{workspaceId\}`,[\s\S]*?20, 10 \* 60_000/);
  assert.match(uploadRoute, /consumeRateLimit\(`workbook-inspection:\$\{workspaceId\}`,[\s\S]*?20, 10 \* 60_000/);
  assert.match(uploadRoute, /const \{ workspaceId \} = await requireWorkspace\(\)[\s\S]*?const form = await readForm\(request\)[\s\S]*?form\.get\("file"\)/);
  assert.match(uploadRoute, /assertSameOriginMutation\(request\)[\s\S]*?requireWorkspace\(\)/);
  assert.doesNotMatch(uploadUi.match(/async function apiPostForm\([\s\S]*?\n}/)?.[0] || "", /Content-Type|headers:/i);
});
