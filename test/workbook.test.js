import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { getWorkbookSheetNames, uploadWorkbook } from "../lib/workbook.js";
import { workspaceTableName } from "../lib/csv.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const apiRoute = readFileSync(new URL("../app/SQG/content/v1/[...path]/route.js", import.meta.url), "utf8");
const composer = readFileSync(new URL("../app/queryra-web-composer.jsx", import.meta.url), "utf8");

async function workbookFile(setup, name = "sales.xlsx") {
  const workbook = new ExcelJS.Workbook();
  setup(workbook);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
    bytes: buffer,
  };
}

function fakeDb() {
  const calls = [];
  const client = {
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; },
    release() {},
  };
  return {
    calls,
    async getRoleName(role) { assert.equal(role, "reader"); return "queryra_reader"; },
    getDbPool(role) { assert.equal(role, "admin"); return { connect: async () => client }; },
  };
}

test("workbook sheet discovery returns worksheet names from a real XLSX payload", async () => {
  const file = await workbookFile((workbook) => {
    workbook.addWorksheet("Sales").addRow(["region", "revenue"]);
    workbook.addWorksheet("Inventory").addRow(["product", "stock"]);
  });
  assert.deepEqual(await getWorkbookSheetNames(file), ["Sales", "Inventory"]);
});

test("selected worksheet is converted and ingested through the existing transactional CSV service", async () => {
  const file = await workbookFile((workbook) => {
    workbook.addWorksheet("Sales").addRows([
      ["region", "revenue", "workspace_id"],
      ["West, Coast", 42.5, "ignored"],
      ["North", 18, "ignored"],
    ]);
    workbook.addWorksheet("Other").addRows([["unused"], ["wrong sheet"]]);
  });
  const db = fakeDb();
  const result = await uploadWorkbook(file, "Sales", "quarterly_sales", workspaceId, {
    assertRole: async (role) => assert.ok(["reader", "admin"].includes(role)),
    getDbPool: db.getDbPool,
    getRoleName: db.getRoleName,
    getTables: async () => [],
  });
  assert.equal(result.dataset.table_name, workspaceTableName(workspaceId, "quarterly_sales").table);
  assert.equal(result.dataset.row_count, 2);
  assert.deepEqual(result.columns, ["region", "revenue", "source_workspace_id"]);
  const insert = db.calls.find(({ sql }) => sql.startsWith("INSERT INTO"));
  assert.deepEqual(insert.values, [workspaceId, "West, Coast", "42.5", "ignored", workspaceId, "North", "18", "ignored"]);
  assert.deepEqual(result.source, { file_name: "sales.xlsx", worksheet: "Sales", format: "xlsx" });
  assert.ok(db.calls.some(({ sql }) => sql === "COMMIT"));
});

test("legacy XLS, malformed workbooks, missing sheets, and empty worksheets are rejected", async () => {
  await assert.rejects(getWorkbookSheetNames({ name: "sales.xls", type: "application/vnd.ms-excel", size: 1, arrayBuffer: async () => new ArrayBuffer(1) }), (error) => error.code === "INVALID_WORKBOOK_TYPE");
  const invalid = { name: "broken.xlsx", type: "", size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
  await assert.rejects(getWorkbookSheetNames(invalid), (error) => error.code === "INVALID_WORKBOOK");
  const file = await workbookFile((workbook) => { workbook.addWorksheet("Blank"); });
  await assert.rejects(uploadWorkbook(file, "Missing", "data", workspaceId), (error) => error.code === "INVALID_WORKSHEET");
  await assert.rejects(uploadWorkbook(file, "Blank", "data", workspaceId), (error) => error.code === "EMPTY_WORKSHEET");
});

test("formula cells without cached results and oversized expanded archives fail safely", async () => {
  const formulaFile = await workbookFile((workbook) => {
    workbook.addWorksheet("Sales").addRows([["amount"], [{ formula: "1+2" }]]);
  });
  await assert.rejects(uploadWorkbook(formulaFile, "Sales", "data", workspaceId), (error) => error.code === "WORKBOOK_FORMULA_UNAVAILABLE");

  const huge = await workbookFile((workbook) => { workbook.addWorksheet("Sheet1").addRow(["value"]); });
  const bytes = Buffer.from(huge.bytes);
  const centralDirectory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.notEqual(centralDirectory, -1);
  bytes.writeUInt32LE(50 * 1024 * 1024 + 1, centralDirectory + 24);
  const invalidArchive = { ...huge, size: bytes.byteLength, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  await assert.rejects(getWorkbookSheetNames(invalidArchive), (error) => error.code === "WORKBOOK_TOO_LARGE");
});

test("workbook upload rejects missing workspace authorization before a database write", async () => {
  const file = await workbookFile((workbook) => workbook.addWorksheet("Sales").addRows([["amount"], [4]]));
  await assert.rejects(uploadWorkbook(file, "Sales", "data", null), (error) => error.code === "WORKSPACE_REQUIRED");
});

test("guest workbook routes stay session-scoped while the saved-workspace API remains authenticated", () => {
  assert.match(apiRoute, /assertSameOriginMutation\(request\)[\s\S]*?endpoint === "guest-workbook-sheets"[\s\S]*?endpoint === "guest-ask"[\s\S]*?requireWorkspace\(\)/);
  assert.match(apiRoute, /endpoint === "guest-ask"[\s\S]*?runGuestQuery/);
  assert.match(apiRoute, /requireWorkspace\(\)[\s\S]*?endpoint === "upload-workbook"[\s\S]*?uploadWorkbook/);
  assert.match(apiRoute, /endpoint === "workbook-sheets"[\s\S]*?readForm\(request\)[\s\S]*?getWorkbookSheetNames/);
  assert.match(apiRoute, /endpoint === "upload-workbook"[\s\S]*?const worksheetName = form\.get\("worksheet_name"\)[\s\S]*?uploadWorkbook\(form\.get\("file"\), worksheetName/);
  assert.match(composer, /\/guest-workbook-sheets/);
  assert.match(composer, /\/guest-ask/);
  assert.doesNotMatch(composer, /\/tables|Authenticated · workspace scoped/);
  assert.match(composer, /Upload a CSV or Excel workbook/);
  assert.match(composer, /onDragOver/);
  assert.match(composer, /onDrop/);
});
