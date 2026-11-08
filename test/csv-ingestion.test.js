import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsvData, uploadCsv, workspaceTableName } from "../lib/csv.js";

test("parses quoted CSV, sanitizes duplicate headers, and infers column types", () => {
  const parsed = parseCsvData('\uFEFFOrder ID,Order ID,amount,notes\n1,1,12.5,"hello, world"\n2,2,3,plain');
  assert.deepEqual(parsed.columns, ["order_id", "order_id_2", "amount", "notes"]);
  assert.deepEqual(parsed.types, ["integer", "integer", "double precision", "text"]);
  assert.equal(parsed.data[0][3], "hello, world");
});

test("parses quoted newlines, preserves null cells, and widens integers without overflow", () => {
  const parsed = parseCsvData('note,count,huge,blank\n"first line\nsecond line",1,9223372036854775808,\nplain,2147483648,999999999999999999999999999999,');
  assert.equal(parsed.data[0][0], "first line\nsecond line");
  assert.deepEqual(parsed.types, ["text", "bigint", "numeric", "text"]);
  assert.equal(parsed.data[0][3], "");
});

test("keeps customer-style identifiers and invalid calendar dates as text instead of misclassifying them", () => {
  const parsed = parseCsvData("customer_id,transaction_id,created_at,signup_date\nCUST-1001,TXN-10001,2025-03-02T09:30:00Z,2025-02-30\nCUST-1002,TXN-10002,2025-03-03T10:00:00Z,2025-03-03");

  assert.deepEqual(parsed.types, ["text", "text", "timestamp", "text"]);
});

test("rejects rows wider than their header and excessive column counts", () => {
  assert.throws(() => parseCsvData("a,b\n1,2,3"), /more values than the header/i);
  assert.throws(() => parseCsvData(Array.from({ length: 201 }, (_, index) => `col${index}`).join(",")), /at most 200 columns/i);
  assert.throws(() => parseCsvData('a,b\n1,"unterminated'), (error) => error.code === "INVALID_CSV");
});

test("rejects CSVs beyond the row-count limit", () => {
  const content = `id\n${Array.from({ length: MAX_CSV_ROWS + 1 }, () => "1").join("\n")}`;
  assert.throws(() => parseCsvData(content), /at most 100000 data rows/i);
});

test("rejects an oversized file before reading its contents", async () => {
  const file = { name: "large.csv", size: MAX_CSV_BYTES + 1 };
  await assert.rejects(uploadCsv(file), (error) => error.status === 413 && /no larger than/i.test(error.message));
});

test("keeps sanitized PostgreSQL identifiers within the 63-byte limit", () => {
  const long = "a".repeat(63);
  const parsed = parseCsvData(`${long},${long}\n1,2`);
  assert.equal(parsed.columns[0].length, 63);
  assert.equal(parsed.columns[1].length, 63);
  assert.notEqual(parsed.columns[0], parsed.columns[1]);
});

test("resolves collisions between duplicate-header suffixes and existing headers", () => {
  const parsed = parseCsvData("a,a,a_2\n1,2,3");
  assert.deepEqual(parsed.columns, ["a", "a_2", "a_2_2"]);
});

test("preserves source headers while mapping spaces, duplicates, empty, punctuation, and Unicode headers to unique identifiers", () => {
  const parsed = parseCsvData(',Order Name,Order Name,Amount ($),候補,workspace_id,source_workspace_id\n,first,duplicate,,東京,source_id,existing_id');
  assert.deepEqual(parsed.columns, ["column_1", "order_name", "order_name_2", "amount", "column_5", "workspace_id", "source_workspace_id"]);
  assert.deepEqual(parsed.headerMappings.map(({ sourceName, normalizedName, sourceIndex }) => ({ sourceName, normalizedName, sourceIndex })), [
    { sourceName: "", normalizedName: "column_1", sourceIndex: 0 },
    { sourceName: "Order Name", normalizedName: "order_name", sourceIndex: 1 },
    { sourceName: "Order Name", normalizedName: "order_name_2", sourceIndex: 2 },
    { sourceName: "Amount ($)", normalizedName: "amount", sourceIndex: 3 },
    { sourceName: "候補", normalizedName: "column_5", sourceIndex: 4 },
    { sourceName: "workspace_id", normalizedName: "workspace_id", sourceIndex: 5 },
    { sourceName: "source_workspace_id", normalizedName: "source_workspace_id", sourceIndex: 6 },
  ]);
  assert.deepEqual(parsed.data[0], ["", "first", "duplicate", "", "東京", "source_id", "existing_id"]);
});

test("empty files and malformed CSV data return validation errors", () => {
  assert.throws(() => parseCsvData("\n  \n"), (error) => error.status === 400 && /CSV file is empty/.test(error.message));
  assert.throws(() => parseCsvData('name,note\n"unterminated'), (error) => error.code === "INVALID_CSV");
});

test("reserves the workspace isolation column and scopes physical table names by full workspace id", () => {
  const table = workspaceTableName("11111111-1111-4111-8111-111111111111", "orders");
  assert.equal(table.table, "qr_11111111111141118111111111111111_orders");
  assert.equal(workspaceTableName("22222222-2222-4222-8222-222222222222", "orders").table === table.table, false);
  assert.throws(() => workspaceTableName("bad-id", "orders"), (error) => error.code === "WORKSPACE_REQUIRED");
});
