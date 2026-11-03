import { parse } from "csv-parse/sync";
import { assertRlsCapableRole, getPool, getSchemaMetadata, getTableNames } from "./db.js";
import { HttpError } from "./http-error.js";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 100_000;
export const MAX_CSV_COLUMNS = 200;

export function workspaceTableName(workspaceId, desiredTableName) {
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  }
  const prefix = `qr_${workspaceId.replaceAll("-", "")}_`;
  const logicalName = identifier(desiredTableName || "uploaded_table", "uploaded_table").slice(0, 63 - prefix.length);
  return { table: `${prefix}${logicalName}`, logicalName };
}

function identifier(raw, fallback) {
  let value = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63) || fallback;
  if (!/^[a-z_]/.test(value)) value = `_${value}`;
  return value;
}

function inferType(values) {
  const nonempty = values.filter((value) => value !== "" && value != null);
  if (!nonempty.length) return "text";
  if (nonempty.every((v) => /^(true|false)$/i.test(v))) return "boolean";
  if (nonempty.every((v) => /^[-+]?\d+$/.test(v))) {
    const normalized = nonempty.map((v) => v.replace(/^[+]/, "").replace(/^(-?)0+(?=\d)/, "$1"));
    const within = (value, min, max) => {
      try { const number = BigInt(value); return number >= min && number <= max; }
      catch { return false; }
    };
    if (normalized.every((v) => within(v, -2147483648n, 2147483647n))) return "integer";
    if (normalized.every((v) => within(v, -9223372036854775808n, 9223372036854775807n))) return "bigint";
    if (normalized.every((v) => v.replace(/^-/, "").length <= 1000)) return "numeric";
    return "text";
  }
  if (nonempty.every((v) => v.trim() !== "" && Number.isFinite(Number(v)))) return "double precision";
  if (nonempty.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))) return "date";
  if (nonempty.every((v) => !Number.isNaN(Date.parse(v)) && /T/.test(v))) return "timestamp";
  return "text";
}

export function parseCsvData(content) {
  if (!content.trim()) throw new HttpError(400, "CSV file is empty.");
  let records;
  try { records = parse(content, { bom: true, skip_empty_lines: true, relax_column_count: true }); }
  catch { throw new HttpError(400, "CSV content is malformed. Check quoting and delimiters.", "INVALID_CSV"); }
  if (!records.length || !records[0].length) throw new HttpError(400, "CSV header row is missing.");
  if (records[0].length > MAX_CSV_COLUMNS) throw new HttpError(413, `CSV files may contain at most ${MAX_CSV_COLUMNS} columns.`, "TOO_MANY_COLUMNS");
  if (records.length - 1 > MAX_CSV_ROWS) throw new HttpError(413, `CSV files may contain at most ${MAX_CSV_ROWS} data rows.`, "TOO_MANY_ROWS");
  if (records.slice(1).some((row) => row.length > records[0].length)) throw new HttpError(400, "A CSV row contains more values than the header.", "INVALID_CSV");
  const usedColumns = new Set();
  const columns = records[0].map((header, index) => {
    const base = identifier(header, `column_${index + 1}`);
    let candidate = base;
    let suffixNumber = 1;
    while (usedColumns.has(candidate)) {
      suffixNumber += 1;
      const suffix = `_${suffixNumber}`;
      candidate = `${base.slice(0, 63 - suffix.length)}${suffix}`;
    }
    usedColumns.add(candidate);
    return candidate;
  });
  const data = records.slice(1);
  const types = columns.map((_, index) => inferType(data.map((row) => row[index] ?? "")));
  return { columns, data, types };
}

function uploadDatabaseError(error) {
  if (error instanceof HttpError) return error;
  if (error?.code === "28P01" || error?.code === "28000") return new HttpError(503, "CSV database authentication failed. Verify the configured ingestion-role credentials.", "DATABASE_AUTHENTICATION_FAILED");
  if (error?.code === "42501") return new HttpError(503, "CSV ingestion is not permitted by the configured database role. Verify its local grants.", "DATABASE_ROLE_UNSAFE");
  if (error?.code === "42P07" || error?.code === "23505") return new HttpError(409, "A dataset with this name already exists in this workspace. Choose another name.", "DATASET_ALREADY_EXISTS");
  if (["22P02", "22003", "22007", "22008"].includes(error?.code)) return new HttpError(400, "CSV data contains a value that does not match its detected column type.", "CSV_INVALID_DATA");
  if (["08004", "08006", "57P03", "ECONNREFUSED", "ETIMEDOUT"].includes(error?.code) || /timeout exceeded when trying to connect/i.test(error?.message || "")) {
    return new HttpError(503, "The CSV database is unavailable. Verify the local PostgreSQL service and ingestion connection URL.", "DATABASE_UNAVAILABLE");
  }
  return new HttpError(500, "CSV import failed. Verify the ingestion-role permissions and CSV values.", "CSV_IMPORT_FAILED");
}

function schemaTextForUpload(table, columns, types) {
  return `CREATE TABLE ${table} (\n${columns.map((column, index) => `  ${column} ${types[index]}`).join(",\n")}\n);`;
}

export async function uploadCsv(file, desiredTableName, workspaceId, {
  assertRole = assertRlsCapableRole,
  getDbPool = getPool,
  getTables = getTableNames,
} = {}) {
  const allowedMimeTypes = new Set(["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"]);
  const mimeType = String(file?.type || "").split(";")[0].trim().toLowerCase();
  if (!file || !file.name?.toLowerCase().endsWith(".csv") || (mimeType && !allowedMimeTypes.has(mimeType))) throw new HttpError(400, "Choose a valid .csv file.", "INVALID_FILE_TYPE");
  if (file.size > MAX_CSV_BYTES) throw new HttpError(413, `CSV files must be no larger than ${MAX_CSV_BYTES} bytes.`, "UPLOAD_TOO_LARGE");
  if (!workspaceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)) throw new HttpError(401, "An authorized workspace is required.", "WORKSPACE_REQUIRED");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_CSV_BYTES) throw new HttpError(413, `CSV files must be no larger than ${MAX_CSV_BYTES} bytes.`, "UPLOAD_TOO_LARGE");
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new HttpError(400, "CSV file must use valid UTF-8 text encoding.", "INVALID_CSV_ENCODING"); }
  const { columns, data, types } = parseCsvData(content);
  const { table, logicalName: logicalTable } = workspaceTableName(workspaceId, desiredTableName);
  const safeColumns = [];
  const usedNames = new Set();
  for (const [index, rawColumn] of columns.entries()) {
    const base = rawColumn === "workspace_id" ? "source_workspace_id" : rawColumn;
    let candidate = base;
    let suffix = 2;
    while (usedNames.has(candidate)) candidate = `${base.slice(0, 58)}_${suffix++}`;
    usedNames.add(candidate);
    safeColumns.push(candidate || `column_${index + 1}`);
  }
  const existingTables = await getTables(workspaceId);
  if (existingTables.includes(table)) throw new HttpError(409, "A dataset with this name already exists in this workspace. Choose another name.", "DATASET_ALREADY_EXISTS");
  let client;
  try {
    await assertRole("admin");
    client = await getDbPool("admin").connect();
    await client.query("BEGIN");
    await client.query(`CREATE TABLE public."${table}" (workspace_id uuid NOT NULL, ${safeColumns.map((column, index) => `"${column}" ${types[index]}`).join(", ")})`);
    await client.query(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`);
    await client.query(`CREATE POLICY "workspace_isolation" ON public."${table}" USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)`);
    await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    const batchSize = Math.min(500, Math.floor(60_000 / (columns.length + 1)));
    for (let offset = 0; offset < data.length; offset += batchSize) {
      const batch = data.slice(offset, offset + batchSize);
      const width = columns.length + 1;
      const placeholders = batch.map((row, rowIndex) => `(${Array.from({ length: width }, (_, colIndex) => `$${rowIndex * width + colIndex + 1}`).join(",")})`).join(",");
      const values = batch.flatMap((row) => [workspaceId, ...safeColumns.map((_, index) => {
        const value = (row[index] ?? "").trim();
        if (!value) return null;
        if (types[index] === "boolean") return value.toLowerCase() === "true";
        return value;
      })]);
      await client.query(`INSERT INTO public."${table}" (workspace_id, ${safeColumns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("CSV import transaction failed; error code:", error.code || "unknown");
    throw uploadDatabaseError(error);
  } finally { client?.release(); }
  const tables = [...existingTables, table].sort();
  const columnsSchema = safeColumns.map((name, index) => ({ name, data_type: types[index], nullable: true }));
  return {
    dataset: { id: table, name: logicalTable, table_name: table, columns: columnsSchema, row_count: data.length },
    table_name: table,
    dataset_name: logicalTable,
    inserted_rows: data.length,
    columns: safeColumns,
    schema: columnsSchema,
    schema_text: schemaTextForUpload(table, safeColumns, types),
    tables,
  };
}
