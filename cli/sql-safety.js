import { parse } from "pgsql-ast-parser";
import { CliError } from "./errors.js";

export const CLI_MAX_SQL_LENGTH = 50_000;
export const CLI_DEFAULT_RESULT_LIMIT = 100;
export const CLI_MAX_RESULT_LIMIT = 1_000;

const ALLOWED_FUNCTIONS = new Set([
  "abs", "avg", "ceil", "ceiling", "coalesce", "count", "date_part", "date_trunc", "floor", "greatest",
  "least", "length", "lower", "max", "min", "nullif", "power", "round", "sqrt", "string_agg", "sum",
  "trim", "upper", "year", "month", "day", "strftime",
]);

export function validateCliSelect(sql, datasetName = "queryra_data") {
  if (typeof sql !== "string" || !sql.trim()) throw new CliError("Gemini did not return a SQL query.", 5);
  if (sql.length > CLI_MAX_SQL_LENGTH) throw new CliError("Generated SQL exceeds the 50,000 character safety limit.", 5);
  let statements;
  try { statements = parse(sql); }
  catch { throw new CliError("Generated SQL uses syntax outside the CLI's supported safe SQL subset.", 5); }
  if (statements.length !== 1) throw new CliError("Only one SQL statement is allowed.", 5);
  const root = statements[0];
  if (!new Set(["select", "with", "with recursive"]).has(root.type)) throw new CliError("Only read-only SELECT queries are allowed.", 5);

  const cteNames = new Set();
  const collectCtes = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "with") for (const item of node.bind || []) cteNames.add(String(item.alias?.name || item.alias).toLowerCase());
    if (node.type === "with recursive") cteNames.add(String(node.alias?.name || node.alias).toLowerCase());
    for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(collectCtes) : collectCtes(child);
  };
  collectCtes(root);

  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type && ["insert", "update", "delete", "create", "drop", "alter", "truncate", "copy", "transaction", "grant", "revoke", "set", "show", "execute"].includes(node.type)) {
      throw new CliError("Generated SQL contains a write or administrative operation; only read-only SELECT queries are allowed.", 5);
    }
    if (node.type === "select" && node.for) throw new CliError("Row-locking SELECT clauses are not allowed.", 5);
    if (node.type === "table") {
      const name = String(node.name?.name || node.name || "").toLowerCase();
      const schema = node.name?.schema ? String(node.name.schema).toLowerCase() : node.schema ? String(node.schema).toLowerCase() : null;
      if ((schema && schema !== "public") || (name !== datasetName.toLowerCase() && !cteNames.has(name))) throw new CliError("Generated SQL may only read the configured CSV dataset.", 5);
    }
    if (node.type === "call") {
      const name = String(node.function?.name || "").toLowerCase();
      if (node.function?.schema || !ALLOWED_FUNCTIONS.has(name)) throw new CliError(`The SQL function '${name || "unknown"}' is not allowed in the CLI's safe query subset.`, 5);
    }
    for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(visit) : visit(child);
  };
  visit(root);
  return sql.trim().replace(/;+\s*$/, "");
}

export function parseResultLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLI_MAX_RESULT_LIMIT) throw new CliError(`--limit must be an integer from 1 to ${CLI_MAX_RESULT_LIMIT}.`, 2);
  return limit;
}
