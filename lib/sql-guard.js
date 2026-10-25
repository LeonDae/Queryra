import { astMapper, astVisitor, parse, toSql } from "pgsql-ast-parser";
import { HttpError } from "./http-error.js";

export const MAX_SQL_LENGTH = 50_000;
export const MAX_RESULT_ROWS = 1_000;

const ALLOWED_STATEMENTS = new Set(["select", "union", "union all", "with", "with recursive"]);
const BLOCKED_FUNCTIONS = new Set([
  "dblink", "dblink_connect", "dblink_exec", "lo_export", "lo_import", "nextval", "setval", "set_config",
  "pg_cancel_backend", "pg_terminate_backend", "pg_reload_conf", "pg_rotate_logfile", "pg_sleep",
  "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "pg_log_backend_memory_contexts",
  "pg_create_restore_point", "pg_logical_emit_message", "pg_notify",
]);

function statementError(message) {
  return new HttpError(400, message, "SQL_VALIDATION_FAILED");
}

function createBoundedQuery(ast) {
  return {
    type: "select",
    columns: [{ expr: { type: "ref", name: "*" } }],
    from: [{ type: "statement", statement: ast, alias: "queryra_limited" }],
    limit: { limit: { type: "integer", value: MAX_RESULT_ROWS + 1 } },
  };
}

/**
 * Parse exactly one query, reject unsafe AST constructs and wrap the approved
 * SELECT in a server-controlled outer LIMIT. The parser intentionally fails
 * closed on PostgreSQL syntax it cannot parse.
 */
export function validateAndLimitSql(sql, allowedRelations) {
  if (typeof sql !== "string" || !sql.trim()) throw statementError("SQL query is required.");
  if (sql.length > MAX_SQL_LENGTH) throw new HttpError(413, `SQL query exceeds the ${MAX_SQL_LENGTH} character limit.`, "SQL_TOO_LARGE");

  let statements;
  try {
    statements = parse(sql);
  } catch {
    throw statementError("SQL could not be parsed safely. Check the syntax and use supported PostgreSQL SELECT syntax.");
  }
  if (statements.length !== 1) throw statementError("Only one SQL statement is allowed.");

  const root = statements[0];
  if (!ALLOWED_STATEMENTS.has(root.type)) throw statementError("Only read-only SELECT queries are allowed.");

  const relations = new Set(allowedRelations.map((name) => String(name).toLowerCase()));
  const cteNames = new Set();
  const tableRefs = [];
  const functionCalls = [];
  let unsafeSelect = false;
  const visitor = astVisitor((map) => ({
    statement(node) {
      if (!ALLOWED_STATEMENTS.has(node.type)) {
        throw statementError(`Unsupported or modifying SQL construct '${node.type}' is not allowed.`);
      }
      if (node.type === "select" && node.for) unsafeSelect = true;
      if (node.type === "with") {
        for (const item of node.bind || []) cteNames.add(String(item.alias?.name || item.alias).toLowerCase());
      }
      if (node.type === "with recursive") cteNames.add(String(node.alias?.name || node.alias).toLowerCase());
      return map.super().statement(node);
    },
    tableRef(node) {
      tableRefs.push(node);
      return map.super().tableRef(node);
    },
    call(node) {
      functionCalls.push(node.function);
      return map.super().call(node);
    },
  }));

  try {
    visitor.statement(root);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw statementError("SQL contains a construct that could not be validated safely.");
  }
  if (unsafeSelect) throw statementError("Row-locking SELECT clauses are not allowed.");

  for (const relation of tableRefs) {
    const name = String(relation.name || "");
    const schema = relation.schema ? String(relation.schema).toLowerCase() : null;
    if (schema && schema !== "public") throw statementError("Only relations in the public schema are allowed.");
    const isUnqualifiedCte = !schema && cteNames.has(name.toLowerCase());
    if (!name || (!isUnqualifiedCte && !relations.has(name.toLowerCase()))) {
      throw statementError(`Relation '${name || "unknown"}' is not available to this query.`);
    }
  }

  for (const fn of functionCalls) {
    const name = String(fn?.name || "").toLowerCase();
    const schema = fn?.schema ? String(fn.schema).toLowerCase() : null;
    if (BLOCKED_FUNCTIONS.has(name) || name.startsWith("pg_read_") || name.startsWith("pg_ls_") || name.startsWith("pg_advisory_") || schema && schema !== "pg_catalog") {
      throw statementError(`Function '${name || "unknown"}' is not allowed in read-only queries.`);
    }
  }

  try {
    // Qualify base relations, then execution pins search_path to pg_catalog so
    // unqualified names cannot resolve to arbitrary user-defined functions.
    const qualifier = astMapper((map) => ({
      tableRef(relation) {
        const name = String(relation.name || "").toLowerCase();
        if (!relation.schema && !cteNames.has(name)) return { ...relation, schema: "public" };
        return map.super().tableRef(relation);
      },
    }));
    const qualified = qualifier.statement(root);
    return toSql.statement(createBoundedQuery(qualified));
  } catch {
    throw statementError("This SELECT query uses syntax that cannot be safely bounded.");
  }
}
