import { parse } from "pgsql-ast-parser";
import { assertRlsCapableRole, getPool, getSchemaMetadata, getTableNames } from "./db.js";
import { workspaceTableName } from "./csv.js";
import { HttpError } from "./http-error.js";

const ALLOWED_CREATE_TYPES = new Set(["create table"]);

function validationError(message) {
  return new HttpError(400, message, "SCHEMA_STUDIO_VALIDATION_FAILED");
}

/**
 * Parse and validate a CREATE TABLE statement. Only a single CREATE TABLE
 * is allowed — all other statement types are rejected.
 *
 * @param {string} sql  Raw SQL string from the user
 * @returns {{ tableName: string, columns: Array<{ name: string, data_type: string }> }}
 */
export function validateCreateTable(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    throw validationError("A CREATE TABLE statement is required.");
  }

  let statements;
  try {
    statements = parse(sql);
  } catch {
    throw validationError("SQL could not be parsed. Check the syntax and use valid CREATE TABLE syntax.");
  }

  if (statements.length === 0) {
    throw validationError("A CREATE TABLE statement is required.");
  }
  if (statements.length > 1) {
    throw validationError("Only one SQL statement is allowed.");
  }

  const root = statements[0];
  if (!ALLOWED_CREATE_TYPES.has(root.type)) {
    throw validationError(
      `Only CREATE TABLE statements are allowed. Received: '${root.type}'.`,
    );
  }

  const tableName = root.name?.name || root.name;
  if (!tableName || typeof tableName !== "string") {
    throw validationError("Could not determine the table name from the CREATE TABLE statement.");
  }

  const columns = (root.columns || [])
    .filter((col) => col.kind === "column")
    .map((col) => ({
      name: col.name?.name || col.name,
      data_type: dataTypeToString(col.dataType),
    }));

  if (!columns.length) {
    throw validationError("The CREATE TABLE statement must define at least one column.");
  }

  return { tableName, columns };
}

/**
 * Convert a pgsql-ast-parser data type node into a readable string.
 */
function dataTypeToString(dt) {
  if (!dt) return "text";
  const name = dt.name || dt.type || "text";
  if (dt.config?.length) return `${name}(${dt.config.join(", ")})`;
  return name;
}

/**
 * Execute a validated CREATE TABLE statement within the caller's workspace,
 * applying the standard workspace_id column and RLS isolation policy.
 *
 * @param {string} sql          Raw SQL string (must be a single CREATE TABLE)
 * @param {string} workspaceId  Authenticated workspace UUID
 * @returns {Promise<object>}   Result with table name, schema, and updated tables list
 */
export async function executeCreateTable(sql, workspaceId, {
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
  getTables = getTableNames,
  getSchema = getSchemaMetadata,
} = {}) {
  const { tableName, columns } = validateCreateTable(sql);
  const { table, logicalName } = workspaceTableName(workspaceId, tableName);

  const existingTables = await getTables(workspaceId);
  if (existingTables.includes(table)) {
    throw new HttpError(
      409,
      "A table with this name already exists in this workspace. Choose another name.",
      "TABLE_ALREADY_EXISTS",
    );
  }

  // Build safe column definitions, renaming any user column called workspace_id
  const safeColumns = columns.map((col) => {
    const name = col.name === "workspace_id" ? "source_workspace_id" : col.name;
    return { name, data_type: col.data_type };
  });

  const columnsSql = safeColumns
    .map((col) => `"${col.name}" ${col.data_type}`)
    .join(", ");

  let client;
  try {
    await assertRole("admin");
    client = await getDbPool("admin").connect();
    await client.query("BEGIN");
    await client.query(
      `CREATE TABLE public."${table}" (workspace_id uuid NOT NULL, ${columnsSql})`,
    );
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
    await client.query(
      `CREATE POLICY "workspace_isolation" ON public."${table}" USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)`,
    );
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof HttpError) throw error;
    if (error?.code === "42P07" || error?.code === "23505") {
      throw new HttpError(409, "A table with this name already exists in this workspace. Choose another name.", "TABLE_ALREADY_EXISTS");
    }
    console.error("Schema Studio CREATE TABLE failed; error code:", error.code || "unknown");
    throw new HttpError(500, "Table creation failed. Verify your SQL and try again.", "SCHEMA_STUDIO_EXECUTION_FAILED");
  } finally {
    client?.release();
  }

  const tables = [...existingTables, table].sort();
  const schemaText = await getSchema(tables, workspaceId);

  return {
    table_name: table,
    logical_name: logicalName,
    columns: safeColumns,
    tables,
    schema_text: schemaText,
  };
}
