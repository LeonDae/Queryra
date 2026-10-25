import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "pgsql-ast-parser";
import { MAX_RESULT_ROWS, validateAndLimitSql } from "../lib/sql-guard.js";

const relations = ["orders", "users", "events"];

function expectRejected(sql, phrase) {
  assert.throws(() => validateAndLimitSql(sql, relations), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, phrase);
    return true;
  });
}

test("allows joins, filters, aggregation, and adds a server controlled result cap", () => {
  const sql = validateAndLimitSql(
    "SELECT u.name, COUNT(o.id) AS order_count FROM public.users u LEFT JOIN public.orders o ON o.user_id = u.id WHERE o.created_at >= DATE '2025-01-01' GROUP BY u.name ORDER BY order_count DESC",
    relations,
  );
  assert.match(sql, /public\.users/);
  assert.match(sql, /public\.orders/);
  assert.match(sql, new RegExp(`LIMIT \\(${MAX_RESULT_ROWS + 1}\\)`));
  assert.equal(parse(sql).length, 1);
});

test("allows read-only CTEs and unions while bounding the final result", () => {
  const cteSql = validateAndLimitSql("WITH recent AS (SELECT id FROM events WHERE event_type = 'click') SELECT id FROM recent", relations);
  const unionSql = validateAndLimitSql("SELECT id FROM users UNION SELECT user_id AS id FROM orders LIMIT 50000", relations);
  assert.match(cteSql, /LIMIT \(1001\)/);
  assert.match(cteSql, /public\.events/);
  assert.match(cteSql, /FROM recent/);
  assert.match(unionSql, /LIMIT \(1001\)/);
  assert.equal(parse(cteSql).length, 1);
  assert.equal(parse(unionSql).length, 1);
});

test("rejects multiple statements, non-select statements, and modifying CTEs", () => {
  expectRejected("SELECT * FROM users; DELETE FROM users", /one SQL statement/i);
  expectRejected("DELETE FROM users", /only read-only SELECT/i);
  expectRejected("WITH removed AS (DELETE FROM users RETURNING *) SELECT * FROM removed", /modifying SQL construct/i);
});

test("rejects unapproved schemas, relations, and side-effecting functions", () => {
  expectRejected("SELECT * FROM information_schema.tables", /public schema/i);
  expectRejected("SELECT * FROM payroll", /not available/i);
  expectRejected("WITH payroll AS (SELECT 1) SELECT * FROM public.payroll", /not available/i);
  expectRejected("SELECT pg_catalog.pg_sleep(5)", /not allowed/i);
  expectRejected("SELECT * FROM users FOR UPDATE", /row-locking/i);
  expectRejected("SELECT * FROM users TABLESAMPLE SYSTEM (10)", /could not be parsed safely/i);
});

test("rejects SQL longer than the configured parser boundary", () => {
  assert.throws(() => validateAndLimitSql(`${" ".repeat(50_000)}SELECT 1`, relations), (error) => {
    assert.equal(error.status, 413);
    assert.match(error.message, /character limit/i);
    return true;
  });
});
