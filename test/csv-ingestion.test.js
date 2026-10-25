import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsvData, uploadCsv } from "../lib/csv.js";

test("parses quoted CSV, sanitizes duplicate headers, and infers column types", () => {
  const parsed = parseCsvData('\uFEFFOrder ID,Order ID,amount,notes\n1,1,12.5,"hello, world"\n2,2,3,plain');
  assert.deepEqual(parsed.columns, ["order_id", "order_id_2", "amount", "notes"]);
  assert.deepEqual(parsed.types, ["integer", "integer", "double precision", "text"]);
  assert.equal(parsed.data[0][3], "hello, world");
});

test("rejects rows wider than their header and excessive column counts", () => {
  assert.throws(() => parseCsvData("a,b\n1,2,3"), /more values than the header/i);
  assert.throws(() => parseCsvData(Array.from({ length: 201 }, (_, index) => `col${index}`).join(",")), /at most 200 columns/i);
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
