import { parentPort, workerData } from "node:worker_threads";
import { DuckDBInstance } from "@duckdb/node-api";

let timedOut = false;

async function run() {
  const instance = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "1GB" });
  const connection = await instance.connect();
  const queryTimer = setTimeout(() => { timedOut = true; connection.interrupt(); }, workerData.timeoutMs);
  try {
    await connection.run("CREATE SCHEMA public");
    const table = `public.\"${workerData.tableName}\"`;
    await connection.run(`CREATE TABLE ${table} AS SELECT * FROM read_csv_auto($file, header = true, sample_size = 20480)`, { file: workerData.filePath });
    const description = await connection.runAndReadAll(`DESCRIBE ${table}`);
    const columns = description.getRowObjectsJson();
    if (columns.length > 200) throw new Error("CSV files are limited to 200 columns.");
    const schema = columns.map((row) => `${row.column_name} ${row.column_type}`).join("\n");
    const columnNames = columns.map((row) => row.column_name);
    if (Buffer.byteLength(schema) > 32_768) throw new Error("CSV schema metadata exceeds the 32 KiB generation limit.");
    if (!schema) throw new Error("CSV must include a header and at least one column.");
    if (workerData.action === "schema") {
      parentPort.postMessage({ ok: true, schema, columns: columnNames, tableName: workerData.tableName });
      return;
    }
    const query = `SELECT * FROM (${workerData.sql}) AS queryra_cli_result LIMIT ${workerData.limit + 1}`;
    try {
      await connection.run(`EXPLAIN ${query}`);
    } catch (error) {
      const detail = String(error?.message || "");
      const missing = detail.match(/(?:referenced )?column\s+["']([^"']+)["']\s+(?:not found|does not exist)/i);
      if (missing) {
        const field = missing[1].replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100);
        const available = columnNames.slice(0, 20).map((name) => `\"${String(name).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 100)}\"`);
        const more = columnNames.length > available.length ? `, and ${columnNames.length - available.length} more` : "";
        throw new Error(`The generated SQL refers to column \"${field}\", which is not in the selected CSV. Available columns: ${available.join(", ")}${more}.`);
      }
      throw error;
    }
    const result = await connection.stream(query);
    const rows = [];
    let outputBytes = 0;
    let truncated = false;
    for await (const chunk of result.yieldRowObjectJson()) {
      for (const row of chunk) {
        if (rows.length === workerData.limit) { truncated = true; break; }
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (outputBytes + rowBytes > workerData.maxOutputBytes) throw new Error("Query results exceed the configured output size limit. Use fewer columns or a smaller --limit.");
        rows.push(row);
        outputBytes += rowBytes + 1;
      }
      if (truncated) break;
    }
    result.closeSync();
    const output = { ok: true, schema, columns: columnNames, tableName: workerData.tableName, rows, truncated };
    parentPort.postMessage(output);
  } finally {
    clearTimeout(queryTimer);
    connection.disconnectSync();
    instance.closeSync();
  }
}

run().catch((error) => {
  if (timedOut) {
    parentPort.postMessage({ ok: false, error: `CSV processing exceeded the ${workerData.timeoutMs} ms execution limit.` });
    return;
  }
  const detail = String(error?.message || "");
  const safeMessage = /output (?:size )?limit/i.test(detail)
    ? "Query results exceed the 2 MiB output limit. Use fewer columns or a smaller --limit."
    : /200 columns/i.test(detail)
      ? "CSV files are limited to 200 columns."
      : /schema metadata/i.test(detail)
        ? "CSV schema metadata exceeds the generation limit."
    : /generated SQL refers to column/i.test(detail)
      ? detail
      : /CSV|file|parser error|IO Error/i.test(detail)
      ? "DuckDB could not read the selected CSV. Check that it has a valid header and consistent UTF-8 rows."
      : "DuckDB could not execute the validated query against the selected CSV schema.";
  parentPort.postMessage({ ok: false, error: safeMessage });
});
