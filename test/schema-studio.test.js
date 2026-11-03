import test from "node:test";
import assert from "node:assert/strict";
import { validateCreateTable } from "../lib/schema-studio.js";
import { deleteTableRequestSchema, schemaStudioRequestSchema } from "../lib/api-schemas.js";

test("schemaStudioRequestSchema validates bounded SQL input", () => {
  assert.equal(
    schemaStudioRequestSchema.parse({ sql: "CREATE TABLE test (id INT);" }).sql,
    "CREATE TABLE test (id INT);",
  );
  assert.throws(() => schemaStudioRequestSchema.parse({ sql: "" }));
  assert.throws(() => schemaStudioRequestSchema.parse({ sql: "   " }));
  assert.throws(() => schemaStudioRequestSchema.parse({ sql: "x".repeat(50_001) }));
  assert.throws(() => schemaStudioRequestSchema.parse({ sql: "CREATE TABLE a (b INT)", extra: true }));
});

test("validateCreateTable accepts valid CREATE TABLE statements", () => {
  const result = validateCreateTable(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      created_at TIMESTAMP
    );
  `);
  assert.equal(result.tableName, "customers");
  assert.equal(result.columns.length, 4);
  assert.equal(result.columns[0].name, "id");
  assert.equal(result.columns[1].name, "name");
  assert.equal(result.columns[2].name, "email");
  assert.equal(result.columns[3].name, "created_at");
});

test("validateCreateTable rejects non-CREATE TABLE statements", () => {
  assert.throws(() => validateCreateTable("DROP TABLE customers;"), /Only CREATE TABLE statements are allowed/);
  assert.throws(() => validateCreateTable("ALTER TABLE customers ADD COLUMN age INT;"), /Only CREATE TABLE statements are allowed/);
  assert.throws(() => validateCreateTable("TRUNCATE TABLE customers;"), /Only CREATE TABLE statements are allowed/);
  assert.throws(() => validateCreateTable("DELETE FROM customers;"), /Only CREATE TABLE statements are allowed/);
  assert.throws(() => validateCreateTable("INSERT INTO customers VALUES (1);"), /Only CREATE TABLE statements are allowed/);
  assert.throws(() => validateCreateTable("SELECT * FROM customers;"), /Only CREATE TABLE statements are allowed/);
});

test("validateCreateTable rejects multiple statements", () => {
  assert.throws(
    () => validateCreateTable("CREATE TABLE a (id INT); DROP TABLE b;"),
    /Only one SQL statement is allowed/,
  );
});

test("validateCreateTable rejects malformed SQL", () => {
  assert.throws(() => validateCreateTable("NOT A SQL STATEMENT"), /SQL could not be parsed/);
});

test("deleteTableRequestSchema validates table name", () => {
  assert.equal(deleteTableRequestSchema.parse({ tableName: "sales_data" }).tableName, "sales_data");
  assert.throws(() => deleteTableRequestSchema.parse({ tableName: "" }));
  assert.throws(() => deleteTableRequestSchema.parse({ tableName: "   " }));
  assert.throws(() => deleteTableRequestSchema.parse({ tableName: "x".repeat(129) }));
  assert.throws(() => deleteTableRequestSchema.parse({ tableName: "t", extra: 1 }));
});


