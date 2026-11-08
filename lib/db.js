import { readFileSync } from "node:fs";
import pg from "pg";
import Cursor from "pg-cursor";
import { HttpError } from "./http-error.js";
import { withConcurrencyLimit } from "./resource-controls.js";
import { MAX_RESULT_ROWS, validateAndLimitSql } from "./sql-guard.js";

const { Pool } = pg;
const pools = new Map();
const roleChecks = new Map();
const STATEMENT_TIMEOUT_MS = readPositiveInteger(process.env.DB_STATEMENT_TIMEOUT_MS, 15_000, 120_000);
const MAX_RESULT_BYTES = readPositiveInteger(process.env.MAX_RESULT_BYTES, 2_000_000, 20_000_000);
const POOL_MAX = readPositiveInteger(process.env.DB_POOL_MAX, 5, 50);
const POOL_TIMEOUT_MS = readPositiveInteger(process.env.DB_POOL_TIMEOUT_MS, 5_000, 60_000);

function readPositiveInteger(value, fallback, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`Invalid runtime configuration: expected a positive integer no greater than ${max}.`);
  return parsed;
}

export function resolveDatabaseUrl(role, environment = process.env) {
  const target = environment.DATABASE_TARGET || (environment.NODE_ENV === "production" ? "hosted" : "local");
  if (!["local", "hosted"].includes(target)) throw new HttpError(503, "DATABASE_TARGET must be either local or hosted.", "DATABASE_CONFIGURATION");
  const url = target === "local"
    ? role === "admin" ? environment.DATABASE_LOCAL_ADMIN_URL : environment.DATABASE_LOCAL_READER_URL
    : role === "admin" ? environment.DATABASE_ADMIN_URL : environment.DATABASE_READER_URL;
  if (!url) throw new HttpError(503, target === "local" ? `DATABASE_LOCAL_${role === "admin" ? "ADMIN" : "READER"}_URL is required when DATABASE_TARGET=local; Queryra will not fall back to DATABASE_URL.` : role === "admin" ? "DATABASE_ADMIN_URL is required when DATABASE_TARGET=hosted for CSV ingestion." : "DATABASE_READER_URL is required when DATABASE_TARGET=hosted for query access.", "DATABASE_CONFIGURATION");
  try {
    const parsed = new URL(url);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname) throw new Error();
    if (target === "hosted" && environment.PGSSL === "disable") throw new HttpError(503, "PGSSL=disable is not allowed for hosted database connections.", "DATABASE_CONFIGURATION");
    if (target === "local" && !["localhost", "127.0.0.1", "::1", "[::1]", "postgres"].includes(parsed.hostname.toLowerCase())) {
      throw new HttpError(503, "DATABASE_TARGET=local accepts only the local Docker database hosts (localhost, 127.0.0.1, ::1, or postgres). To use a hosted database, explicitly set DATABASE_TARGET=hosted and its restricted role URLs.", "DATABASE_TARGET_MISMATCH");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, `The configured ${target === "local" ? `local ${role}` : `hosted ${role}`} database URL is malformed. Use a PostgreSQL connection URL.`, "DATABASE_CONFIGURATION");
  }
  return url;
}

export function resolveDatabaseSslOptions(url, environment = process.env) {
  const target = environment.DATABASE_TARGET || (environment.NODE_ENV === "production" ? "hosted" : "local");
  if (environment.PGSSL === "disable") {
    if (target === "hosted") throw new HttpError(503, "PGSSL=disable is not allowed for hosted database connections.", "DATABASE_CONFIGURATION");
    return false;
  }

  if (target !== "hosted" || !/supabase\./i.test(url)) return undefined;

  const caFile = environment.DATABASE_SSL_CA_FILE;
  if (!caFile) {
    throw new HttpError(503, "DATABASE_SSL_CA_FILE is required for hosted Supabase PostgreSQL connections.", "DATABASE_CONFIGURATION");
  }

  let ca;
  try {
    ca = readFileSync(caFile, "utf8");
  } catch {
    throw new HttpError(503, "DATABASE_SSL_CA_FILE must point to a readable PEM certificate file for hosted Supabase PostgreSQL connections.", "DATABASE_CONFIGURATION");
  }

  if (!/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.test(ca)) {
    throw new HttpError(503, "DATABASE_SSL_CA_FILE must contain a PEM certificate for hosted Supabase PostgreSQL connections.", "DATABASE_CONFIGURATION");
  }

  return { ca, rejectUnauthorized: true };
}

export function isRlsRestrictedRole(rows) {
  return rows.length === 1 && rows[0].rolsuper === false && rows[0].rolbypassrls === false && rows[0].inherited_bypass === false;
}

export function isReadOnlyReaderRole(rows) {
  return isRlsRestrictedRole(rows)
    && rows[0].rolinherit === false
    && rows[0].default_read_only === "on"
    && rows[0].role_memberships === false
    && rows[0].public_create === false
    && rows[0].public_write_privileges === false
    && rows[0].public_sequence_write_privileges === false;
}

export function isSafeIngestionRole(rows) {
  return isRlsRestrictedRole(rows)
    && rows[0].rolinherit === false
    && rows[0].role_memberships === false
    && rows[0].public_usage === true
    && rows[0].public_create === true;
}

export function getPool(role = "reader") {
  const url = resolveDatabaseUrl(role);
  if (!pools.has(role)) {
    const pool = new Pool({
      connectionString: url,
      ssl: resolveDatabaseSslOptions(url),
      max: POOL_MAX,
      connectionTimeoutMillis: POOL_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (error) => console.error(`PostgreSQL ${role} pool error code:`, error.code || "unknown"));
    pools.set(role, pool);
  }
  return pools.get(role);
}

export async function getDatabaseRoleName(role) {
  const { rows } = await getPool(role).query("SELECT current_user AS role_name");
  const roleName = rows[0]?.role_name;
  if (!roleName) throw new HttpError(503, `The configured ${role} database role could not be resolved.`, "DATABASE_CONFIGURATION");
  return roleName;
}

export async function checkDatabaseHealth() {
  try {
    await assertRlsCapableRole("reader");
    await getPool("reader").query("SELECT 1");
    return { status: "UP", target: process.env.DATABASE_TARGET || (process.env.NODE_ENV === "production" ? "hosted" : "local"), database: "connected" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (["28P01", "28000"].includes(error.code)) throw new HttpError(503, "Database authentication failed. Verify the configured reader role credentials.", "DATABASE_AUTHENTICATION_FAILED");
    if (["3D000"].includes(error.code)) throw new HttpError(503, "The configured database is unavailable. Verify the database name and connection URL.", "DATABASE_UNAVAILABLE");
    console.error("Database health check failed; error code:", error.code || "unknown");
    throw new HttpError(503, "The configured database could not be reached. Verify network access and connection settings.", "DATABASE_UNAVAILABLE");
  }
}

export async function assertRlsCapableRole(role) {
  if (roleChecks.has(role)) return roleChecks.get(role);
  const check = (async () => {
    const client = await getPool(role).connect();
    try {
      const { rows } = await client.query(`
        SELECT active.rolsuper, active.rolbypassrls, active.rolinherit,
          EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolbypassrls AND pg_has_role(active.oid, r.oid, 'SET')) AS inherited_bypass,
          current_setting('default_transaction_read_only') AS default_read_only,
          EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = active.oid) AS role_memberships,
          has_schema_privilege(active.oid, 'public', 'USAGE') AS public_usage,
          has_schema_privilege(active.oid, 'public', 'CREATE') AS public_create,
          EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND (has_table_privilege(active.oid, c.oid, 'INSERT')
                OR has_table_privilege(active.oid, c.oid, 'UPDATE')
                OR has_table_privilege(active.oid, c.oid, 'DELETE')
                OR has_table_privilege(active.oid, c.oid, 'TRUNCATE')
                OR has_table_privilege(active.oid, c.oid, 'REFERENCES')
                OR has_table_privilege(active.oid, c.oid, 'TRIGGER'))
          ) AS public_write_privileges,
          EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'S'
              AND (has_sequence_privilege(active.oid, c.oid, 'USAGE')
                OR has_sequence_privilege(active.oid, c.oid, 'UPDATE'))
          ) AS public_sequence_write_privileges
        FROM pg_roles active WHERE active.rolname = current_user
      `);
      if (!isRlsRestrictedRole(rows)) throw new HttpError(503, `The configured ${role} database role can bypass Row Level Security. Use a restricted non-superuser role without BYPASSRLS or a bypass-role membership.`, "DATABASE_ROLE_UNSAFE");
      if (role === "reader" && !isReadOnlyReaderRole(rows)) throw new HttpError(503, "The reader must be NOINHERIT, have no role memberships, use read-only transactions, and have no public schema CREATE or table/sequence write grants.", "DATABASE_ROLE_UNSAFE");
      if (role === "admin" && !isSafeIngestionRole(rows)) throw new HttpError(503, "The ingestion role must be NOINHERIT, have no role memberships, have USAGE and CREATE on public, and cannot be a superuser or bypass Row Level Security.", "DATABASE_ROLE_UNSAFE");
    } finally { client.release(); }
  })();
  roleChecks.set(role, check);
  try { await check; } catch (error) { roleChecks.delete(role); throw error; }
}

export async function getTableNames(workspaceId) {
  if (!workspaceId) throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  try {
    await assertRlsCapableRole("reader");
    const { rows } = await getPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND left(table_name, char_length($1)) = $1
      ORDER BY table_name
    `, [`qr_${workspaceId.replaceAll("-", "")}_`]);
    return rows.map((row) => row.table_name);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not list authorized public relations; error code:", error.code || "unknown");
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
}

export async function getWorkspaceTableNames(workspaceId, {
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
} = {}) {
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  }
  try {
    await assertRole("admin");
    const { rows } = await getDbPool("admin").query(`
      SELECT c.relname AS table_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND left(c.relname, char_length($1)) = $1
      ORDER BY c.relname
    `, [`qr_${workspaceId.replaceAll("-", "")}_`]);
    return rows.map((row) => row.table_name);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not list workspace tables; error code:", error.code || "unknown");
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
}

export function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export async function ensureWorkspaceReaderAccess(workspaceId, {
  tableNames,
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
  getRoleName = getDatabaseRoleName,
  getTables = getWorkspaceTableNames,
} = {}) {
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  }
  const names = tableNames || await getTables(workspaceId);
  if (!names.length) return;
  const prefix = `qr_${workspaceId.replaceAll("-", "")}_`;

  await assertRole("reader");
  const readerRole = await getRoleName("reader");

  await assertRole("admin");
  const client = await getDbPool("admin").connect();
  try {
    const { rows: ownedTables } = await client.query(`
      SELECT c.relname AS table_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relowner = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)
        AND left(c.relname, char_length($2)) = $2
        AND c.relname = ANY($1::text[])
        AND NOT has_table_privilege((SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $3), c.oid, 'SELECT')
    `, [names, prefix, readerRole]);
    for (const { table_name: tableName } of ownedTables) {
      await client.query(`GRANT SELECT ON TABLE public.${quoteIdentifier(tableName)} TO ${quoteIdentifier(readerRole)}`);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not grant reader access to workspace tables; error code:", error.code || "unknown");
    throw new HttpError(503, "The reader could not be given SELECT access to an uploaded workspace table. Verify the ingestion role owns the table.", "DATABASE_ROLE_UNSAFE");
  } finally {
    client.release();
  }
}

export async function deleteTable(tableName, workspaceId, {
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
  getTables = getWorkspaceTableNames,
  getSchema = getWorkspaceSchemaMetadata,
} = {}) {
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  if (!tableName || typeof tableName !== "string") throw new HttpError(400, "Table name is required.", "INVALID_REQUEST");
  const prefix = `qr_${workspaceId.replaceAll("-", "")}_`;
  if (/^qr_[0-9a-f]{32}_/i.test(tableName) && !tableName.startsWith(prefix)) {
    throw new HttpError(404, "Table not found in this workspace.", "TABLE_NOT_FOUND");
  }
  const logicalName = tableName.startsWith(prefix) ? tableName.slice(prefix.length) : tableName;
  if (logicalName.length > 63 - prefix.length || !/^[a-z_][a-z0-9_]*$/i.test(logicalName)) {
    throw new HttpError(400, "Table name contains invalid characters or exceeds the PostgreSQL identifier limit.", "INVALID_TABLE_NAME");
  }
  const fullTableName = `${prefix}${logicalName}`;
  const existingTables = await getTables(workspaceId);
  if (!existingTables.includes(fullTableName)) {
    throw new HttpError(404, "Table not found in this workspace.", "TABLE_NOT_FOUND");
  }

  let client;
  try {
    await assertRole("admin");
    client = await getDbPool("admin").connect();
    await client.query(`DROP TABLE public."${fullTableName}"`);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not delete workspace table; error code:", error.code || "unknown");
    if (error?.code === "42501") throw new HttpError(503, "The ingestion role does not own this workspace table or lacks permission to remove it.", "DATABASE_ROLE_UNSAFE");
    if (error?.code === "42P01") throw new HttpError(404, "Table not found in this workspace.", "TABLE_NOT_FOUND");
    throw new HttpError(500, "Failed to delete table.", "TABLE_DELETE_FAILED");
  } finally {
    client?.release();
  }

  const remainingTables = await getTables(workspaceId);
  const remainingSchema = await getSchema(remainingTables, workspaceId);

  return {
    deletedTable: fullTableName,
    tables: remainingTables,
    schema_text: remainingSchema,
  };
}

async function schemaMetadataForTables(names, role, { assertRole = assertRlsCapableRole, getDbPool = getPool } = {}) {
  if (!names.length) return "";
  let rows;
  try {
    await assertRole(role);
    ({ rows } = await getDbPool(role).query(
      `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
            CASE WHEN pk.column_name IS NULL THEN false ELSE true END AS is_primary
     FROM information_schema.columns c
     LEFT JOIN (
       SELECT ku.table_name, ku.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage ku
         ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
     ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
     WHERE c.table_schema = 'public' AND c.table_name = ANY($1::text[])
       AND c.column_name <> 'workspace_id'
     ORDER BY c.table_name, c.ordinal_position`,
      [names],
    ));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not inspect database column metadata; error code:", error.code || "unknown");
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.table_name)) grouped.set(row.table_name, []);
    grouped.get(row.table_name).push(`  ${row.column_name} ${row.data_type}${row.is_primary ? " PRIMARY KEY" : ""}${row.is_nullable === "NO" ? " NOT NULL" : ""}`);
  }
  return [...grouped].map(([table, columns]) => `CREATE TABLE ${table} (\n${columns.join(",\n")}\n);`).join("\n\n");
}

export async function getSchemaMetadata(tableNames, workspaceId) {
  const names = tableNames?.length ? tableNames : await getTableNames(workspaceId);
  return schemaMetadataForTables(names, "reader");
}

export async function getWorkspaceSchemaMetadata(tableNames, workspaceId, {
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
  getTables = getWorkspaceTableNames,
} = {}) {
  const names = tableNames?.length ? tableNames : await getTables(workspaceId);
  return schemaMetadataForTables(names, "admin", { assertRole, getDbPool });
}

function cursorRead(cursor, count) {
  return new Promise((resolve, reject) => cursor.read(count, (error, rows) => error ? reject(error) : resolve(rows)));
}

function cursorClose(cursor) {
  return new Promise((resolve) => cursor.close(() => resolve()));
}

async function executeSelectWithinLimit(sql, requestedRelations, workspaceId) {
  let catalogRelations;
  try {
    catalogRelations = await getTableNames(workspaceId);
  } catch (error) {
    console.error("Could not inspect the authorized public schema; error code:", error.code || "unknown");
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
  let authorizedRelations = catalogRelations;
  if (requestedRelations !== undefined) {
    if (!Array.isArray(requestedRelations) || requestedRelations.length > 200) throw new HttpError(400, "selectedTables must contain at most 200 table names.", "INVALID_REQUEST");
    const catalog = new Set(catalogRelations.map((name) => name.toLowerCase()));
    const invalid = requestedRelations.find((name) => typeof name !== "string" || !catalog.has(name.toLowerCase()));
    if (invalid !== undefined) throw new HttpError(400, "One or more selected tables are unavailable.", "INVALID_RELATION");
    authorizedRelations = requestedRelations;
  }
  const boundedSql = validateAndLimitSql(sql, authorizedRelations);
  let client;
  let cursor;
  const rows = [];
  let byteCount = 2;
  let truncated = false;
  try {
    const pool = getPool("reader");
    if (pool.waitingCount >= 10) throw new HttpError(429, "The query service is at capacity. Try again shortly.", "QUERY_CAPACITY");
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL search_path = pg_catalog");
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
    cursor = client.query(new Cursor(boundedSql));
    while (rows.length <= MAX_RESULT_ROWS) {
      const batch = await cursorRead(cursor, Math.min(10, MAX_RESULT_ROWS + 1 - rows.length));
      if (!batch.length) break;
      for (const row of batch) {
        if (rows.length === MAX_RESULT_ROWS) { truncated = true; break; }
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (byteCount + rowBytes > MAX_RESULT_BYTES) {
          if (!rows.length) throw new HttpError(413, "A query row exceeds the configured result-size limit.", "RESULT_TOO_LARGE");
          truncated = true;
          break;
        }
        rows.push(row);
        byteCount += rowBytes + 1;
      }
      if (truncated || rows.length >= MAX_RESULT_ROWS) break;
    }
    await cursorClose(cursor);
    cursor = null;
    await client.query("COMMIT");
    return { rows, truncated, rowLimit: MAX_RESULT_ROWS };
  } catch (error) {
    if (cursor) await cursorClose(cursor).catch(() => { });
    if (client) await client.query("ROLLBACK").catch(() => { });
    if (error instanceof HttpError) throw error;
    console.error("Read-only SQL execution failed; error code:", error.code || "unknown");
    if (error.code === "57014") throw new HttpError(408, "Query exceeded the database statement timeout.", "QUERY_TIMEOUT");
    if (error.code === "53300" || error.code === "08004" || error.code === "08006" || error.code === "57P03" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || /timeout exceeded when trying to connect/i.test(error.message || "")) {
      throw new HttpError(503, "The database is temporarily unavailable or at capacity.", "DATABASE_UNAVAILABLE");
    }
    throw new HttpError(400, "The database could not execute this query. Check the SQL and authorized schema.", "QUERY_EXECUTION_FAILED");
  } finally {
    client?.release();
  }
}

export async function executeSelect(sql, requestedRelations, workspaceId) {
  if (!workspaceId) throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  return withConcurrencyLimit(
    "database-query",
    "DB_QUERY_CONCURRENCY",
    POOL_MAX,
    () => executeSelectWithinLimit(sql, requestedRelations, workspaceId),
    POOL_MAX,
    { code: "QUERY_CAPACITY", message: "The database query service is at capacity. Try again shortly." },
  );
}
