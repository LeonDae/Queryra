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

test("reserves the workspace isolation column and scopes physical table names by full workspace id", () => {
  const table = workspaceTableName("11111111-1111-4111-8111-111111111111", "orders");
  assert.equal(table.table, "qr_11111111111141118111111111111111_orders");
  assert.equal(workspaceTableName("22222222-2222-4222-8222-222222222222", "orders").table === table.table, false);
  assert.throws(() => workspaceTableName("bad-id", "orders"), (error) => error.code === "WORKSPACE_REQUIRED");
});
