import pg from "pg";
import Cursor from "pg-cursor";
import { HttpError } from "./http-error.js";
import { MAX_RESULT_ROWS, validateAndLimitSql } from "./sql-guard.js";

const { Pool } = pg;
const pools = new Map();
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

export function getPool(role = "reader") {
  const url = role === "admin"
    ? process.env.DATABASE_ADMIN_URL || (process.env.NODE_ENV === "production" ? "" : process.env.DATABASE_URL)
    : process.env.DATABASE_READER_URL || (process.env.NODE_ENV === "production" ? "" : process.env.DATABASE_URL);
  if (!url) throw new HttpError(503, role === "admin" ? "DATABASE_ADMIN_URL is required for production CSV ingestion." : "DATABASE_READER_URL is required for production query access.", "DATABASE_CONFIGURATION");
  if (!pools.has(role)) {
    const isSupabase = /supabase\./i.test(url);
    const pool = new Pool({
      connectionString: url,
      ssl: process.env.PGSSL === "disable" ? false : isSupabase ? { rejectUnauthorized: false } : undefined,
      max: POOL_MAX,
      connectionTimeoutMillis: POOL_TIMEOUT_MS,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (error) => console.error(`PostgreSQL ${role} pool error:`, error.message));
    pools.set(role, pool);
  }
  return pools.get(role);
}

export async function getTableNames() {
  try {
    const { rows } = await getPool().query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_name
    `);
    return rows.map((row) => row.table_name);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not list authorized public relations:", error.message);
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
}

export async function getSchemaMetadata(tableNames) {
  const names = tableNames?.length ? tableNames : await getTableNames();
  if (!names.length) return "";
  let rows;
  try {
    ({ rows } = await getPool().query(
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
     ORDER BY c.table_name, c.ordinal_position`,
      [names],
    ));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not inspect database column metadata:", error.message);
    throw new HttpError(503, "The database schema is temporarily unavailable.", "DATABASE_UNAVAILABLE");
  }
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.table_name)) grouped.set(row.table_name, []);
    grouped.get(row.table_name).push(`  ${row.column_name} ${row.data_type}${row.is_primary ? " PRIMARY KEY" : ""}${row.is_nullable === "NO" ? " NOT NULL" : ""}`);
  }
  return [...grouped].map(([table, columns]) => `CREATE TABLE ${table} (\n${columns.join(",\n")}\n);`).join("\n\n");
}

function cursorRead(cursor, count) {
  return new Promise((resolve, reject) => cursor.read(count, (error, rows) => error ? reject(error) : resolve(rows)));
}

function cursorClose(cursor) {
  return new Promise((resolve) => cursor.close(() => resolve()));
}

export async function executeSelect(sql, requestedRelations) {
  let catalogRelations;
  try {
    catalogRelations = await getTableNames();
  } catch (error) {
    console.error("Could not inspect the authorized public schema:", error.message);
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
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);
    await client.query("SET LOCAL search_path = pg_catalog");
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
    if (cursor) await cursorClose(cursor).catch(() => {});
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error instanceof HttpError) throw error;
    console.error("Read-only SQL execution failed:", error.message);
    if (error.code === "57014") throw new HttpError(408, "Query exceeded the database statement timeout.", "QUERY_TIMEOUT");
    if (error.code === "53300" || error.code === "08004" || error.code === "08006" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") throw new HttpError(503, "The database is temporarily unavailable or at capacity.", "DATABASE_UNAVAILABLE");
    throw new HttpError(400, "The database could not execute this query. Check the SQL and authorized schema.", "QUERY_EXECUTION_FAILED");
  } finally {
    client?.release();
  }
}
