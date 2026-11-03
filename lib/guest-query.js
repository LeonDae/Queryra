import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { generateSql as generateCsvSql } from "../cli/gemini.js";
import { assertQuestionDimensions } from "../cli/question-guard.js";
import { validateCliSelect } from "../cli/sql-safety.js";
import { HttpError } from "./http-error.js";
import { consumeRateLimit, withConcurrencyLimit } from "./resource-controls.js";

export const GUEST_MAX_RESULT_ROWS = 100;
export const GUEST_MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const GUEST_QUERY_TIMEOUT_MS = 15_000;
export const GUEST_TABLE_NAME = "queryra_data";

function safeProviderError(error) {
  if (error?.exitCode === 3) return new HttpError(503, error.message, "PROVIDER_CONFIGURATION");
  if (error?.exitCode === 4) return new HttpError(502, error.message, "PROVIDER_UNAVAILABLE");
  return new HttpError(422, error?.message || "The question could not be answered from this dataset.", "QUERY_NOT_SUPPORTED");
}

function isTimeout(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "57014";
}

export async function runGuestQuery({ csvPath, question, fetchImpl = fetch, duckDb = DuckDBInstance }) {
  const filePath = path.resolve(csvPath);
  const instance = await duckDb.create(":memory:", { threads: "2", memory_limit: "256MB" });
  const connection = await instance.connect();
  let timedOut = false;
  let cursor = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { connection.interrupt(); } catch { /* The connection may have already closed. */ }
  }, GUEST_QUERY_TIMEOUT_MS);
  try {
    await connection.run("CREATE SCHEMA public");
    await connection.run(`CREATE TABLE public."${GUEST_TABLE_NAME}" AS SELECT * FROM read_csv_auto($file, header = true, sample_size = 20480)`, { file: filePath });
    const description = await connection.runAndReadAll(`DESCRIBE public."${GUEST_TABLE_NAME}"`);
    const columns = description.getRowObjectsJson();
    if (!columns.length || columns.length > 200) throw new HttpError(400, "The selected file must have between 1 and 200 columns.", "INVALID_CSV_SCHEMA");
    const columnNames = columns.map((column) => String(column.column_name));
    const schema = columns.map((column) => `${column.column_name} ${column.column_type}`).join("\n");
    if (Buffer.byteLength(schema) > 32_768) throw new HttpError(413, "The file schema exceeds the query context limit.", "SCHEMA_TOO_LARGE");
    try { assertQuestionDimensions(question, schema, columnNames); }
    catch (error) {
      if (error?.exitCode === 5) throw new HttpError(422, error.message, "QUESTION_FIELD_UNAVAILABLE");
      throw error;
    }

    consumeRateLimit("guest-gemini", "GEMINI_REQUESTS_PER_MINUTE", 20, 60_000, 1_000);
    let generated;
    try {
      generated = await withConcurrencyLimit("guest-gemini", "PROVIDER_CONCURRENCY", 2, () => generateCsvSql(question, schema, {
        environment: {
          QUERYRA_GEMINI_API_KEY: process.env.GOOGLE_API_KEY || "",
          QUERYRA_GEMINI_MODEL: process.env.GEMINI_MODEL || "",
        },
        config: {},
        fetchImpl,
        tableName: GUEST_TABLE_NAME,
        columns: columnNames,
      }), 20, { code: "PROVIDER_CAPACITY", message: "The query service is busy. Try again shortly." });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw safeProviderError(error);
    }

    let safeSql;
    try { safeSql = validateCliSelect(generated.sql, GUEST_TABLE_NAME); }
    catch (error) { throw safeProviderError(error); }
    const query = `SELECT * FROM (${safeSql}) AS queryra_guest_result LIMIT ${GUEST_MAX_RESULT_ROWS + 1}`;
    try { await connection.run(`EXPLAIN ${query}`); }
    catch { throw new HttpError(422, "Generated SQL references a field or operation that is not available in this dataset. Choose a question that matches its columns.", "QUERY_SCHEMA_MISMATCH"); }

    cursor = await connection.stream(query);
    const rows = [];
    let outputBytes = 0;
    let truncated = false;
    for await (const chunk of cursor.yieldRowObjectJson()) {
      for (const row of chunk) {
        if (rows.length === GUEST_MAX_RESULT_ROWS) { truncated = true; break; }
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (outputBytes + rowBytes > GUEST_MAX_RESULT_BYTES) {
          if (!rows.length) throw new HttpError(413, "A result row exceeds the response-size limit.", "RESULT_TOO_LARGE");
          truncated = true;
          break;
        }
        rows.push(row);
        outputBytes += rowBytes + 1;
      }
      if (truncated) break;
    }
    cursor.closeSync();
    cursor = null;
    return { generatedSQL: safeSql, rows, rowCount: rows.length, truncated, providerUsage: generated.providerUsage || null };
  } catch (error) {
    if (cursor) cursor.closeSync();
    if (error instanceof HttpError) throw error;
    if (timedOut || isTimeout(error)) throw new HttpError(408, `Query exceeded the ${GUEST_QUERY_TIMEOUT_MS / 1000}-second execution limit.`, "GUEST_QUERY_TIMEOUT");
    throw new HttpError(422, "DuckDB could not read or query this file. Check that it has a valid header and consistent rows.", "GUEST_QUERY_FAILED");
  } finally {
    clearTimeout(timeout);
    try { connection.disconnectSync(); } catch { /* Already disconnected. */ }
    try { instance.closeSync(); } catch { /* Already closed. */ }
  }
}
