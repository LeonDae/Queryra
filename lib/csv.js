import { parse } from "csv-parse/sync";
import { getPool, getSchemaMetadata, getTableNames } from "./db.js";
import { HttpError } from "./http-error.js";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 100_000;
export const MAX_CSV_COLUMNS = 200;

function identifier(raw, fallback) {
  let value = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 63) || fallback;
  if (!/^[a-z_]/.test(value)) value = `_${value}`;
  return value;
}

function inferType(values) {
  const nonempty = values.filter((value) => value !== "" && value != null).slice(0, 500);
  if (!nonempty.length) return "text";
  if (nonempty.every((v) => /^(true|false)$/i.test(v))) return "boolean";
  if (nonempty.every((v) => /^[-+]?\d+$/.test(v))) return "integer";
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

export async function uploadCsv(file, desiredTableName) {
  if (!file || !file.name?.toLowerCase().endsWith(".csv")) throw new HttpError(400, "Only .csv files are supported.");
  if (file.size > MAX_CSV_BYTES) throw new HttpError(413, `CSV files must be no larger than ${MAX_CSV_BYTES} bytes.`, "UPLOAD_TOO_LARGE");
  const content = Buffer.from(await file.arrayBuffer()).toString("utf8").replace(/^\uFEFF/, "");
  const { columns, data, types } = parseCsvData(content);
  const table = identifier(desiredTableName || "uploaded_table", "uploaded_table");
  if ((await getTableNames()).includes(table)) throw new HttpError(400, `Table '${table}' already exists in Supabase.`);
  const client = await getPool("admin").connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE public."${table}" (${columns.map((column, index) => `"${column}" ${types[index]}`).join(", ")})`);
    const batchSize = Math.min(500, Math.floor(60_000 / columns.length));
    for (let offset = 0; offset < data.length; offset += batchSize) {
      const batch = data.slice(offset, offset + batchSize);
      const placeholders = batch.map((row, rowIndex) => `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(",")})`).join(",");
      const values = batch.flatMap((row) => columns.map((_, index) => {
        const value = (row[index] ?? "").trim();
        if (!value) return null;
        if (types[index] === "boolean") return value.toLowerCase() === "true";
        return value;
      }));
      await client.query(`INSERT INTO public."${table}" (${columns.map((c) => `"${c}"`).join(",")}) VALUES ${placeholders}`, values);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof HttpError) throw error;
    console.error("CSV import transaction failed:", error.message);
    throw new HttpError(500, "CSV import failed. Verify the ingestion-role permissions and confirm that all values match the detected column types.", "CSV_IMPORT_FAILED");
  } finally { client.release(); }
  return { table_name: table, inserted_rows: data.length, columns, schema_text: await getSchemaMetadata(), tables: await getTableNames() };
}
