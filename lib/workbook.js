import ExcelJS from "exceljs";
import { MAX_CSV_BYTES, MAX_CSV_COLUMNS, MAX_CSV_ROWS, uploadCsv } from "./csv.js";
import { HttpError } from "./http-error.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_EXPANDED_WORKBOOK_BYTES = 50 * 1024 * 1024;

function validateZipExpansion(bytes) {
  if (bytes.length < 22) throw new HttpError(400, "The workbook is invalid or corrupted. Save it as a valid .xlsx file and try again.", "INVALID_WORKBOOK");
  const start = Math.max(0, bytes.length - 65_557);
  let endRecord = -1;
  for (let offset = bytes.length - 22; offset >= start; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { endRecord = offset; break; }
  }
  if (endRecord < 0) throw new HttpError(400, "The workbook is invalid or corrupted. Save it as a valid .xlsx file and try again.", "INVALID_WORKBOOK");
  const entryCount = bytes.readUInt16LE(endRecord + 10);
  const centralSize = bytes.readUInt32LE(endRecord + 12);
  const centralStart = bytes.readUInt32LE(endRecord + 16);
  if (entryCount > 5_000 || centralStart + centralSize > bytes.length || centralStart + centralSize > endRecord) {
    throw new HttpError(400, "The workbook archive has invalid or excessive contents.", "INVALID_WORKBOOK");
  }
  let offset = centralStart;
  let expandedBytes = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new HttpError(400, "The workbook archive has invalid or corrupted contents.", "INVALID_WORKBOOK");
    }
    expandedBytes += bytes.readUInt32LE(offset + 24);
    if (expandedBytes > MAX_EXPANDED_WORKBOOK_BYTES) {
      throw new HttpError(413, "The expanded workbook is too large to process safely.", "WORKBOOK_TOO_LARGE");
    }
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  if (offset !== centralStart + centralSize) throw new HttpError(400, "The workbook archive has invalid or corrupted contents.", "INVALID_WORKBOOK");
}

function validateWorkbookFile(file) {
  const mimeType = String(file?.type || "").split(";")[0].trim().toLowerCase();
  if (!file || !file.name?.toLowerCase().endsWith(".xlsx") || (mimeType && mimeType !== XLSX_MIME)) {
    throw new HttpError(400, "Choose a valid .xlsx workbook. Legacy .xls files are not supported.", "INVALID_WORKBOOK_TYPE");
  }
  if (file.size > MAX_CSV_BYTES) throw new HttpError(413, `Workbooks must be no larger than ${MAX_CSV_BYTES} bytes.`, "UPLOAD_TOO_LARGE");
}

async function readWorkbook(file) {
  validateWorkbookFile(file);
  let bytes;
  try { bytes = Buffer.from(await file.arrayBuffer()); }
  catch { throw new HttpError(400, "The workbook could not be read. Choose a valid .xlsx file.", "INVALID_WORKBOOK"); }
  if (!bytes.length || bytes.byteLength > MAX_CSV_BYTES) {
    throw new HttpError(bytes.length ? 413 : 400, bytes.length ? `Workbooks must be no larger than ${MAX_CSV_BYTES} bytes.` : "The workbook is empty.", bytes.length ? "UPLOAD_TOO_LARGE" : "INVALID_WORKBOOK");
  }
  validateZipExpansion(bytes);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); }
  catch { throw new HttpError(400, "The workbook is invalid or corrupted. Save it as a valid .xlsx file and try again.", "INVALID_WORKBOOK"); }
  if (workbook.worksheets.length > 100) throw new HttpError(413, "A workbook may contain at most 100 worksheets.", "TOO_MANY_WORKSHEETS");
  return workbook;
}

export async function getWorkbookSheetNames(file) {
  const workbook = await readWorkbook(file);
  return workbook.worksheets.map(({ name }) => name);
}

export async function workbookToCsv(file, worksheetName) {
  const workbook = await readWorkbook(file);
  if (typeof worksheetName !== "string" || !worksheetName.trim()) {
    throw new HttpError(400, "Choose a worksheet from the workbook before uploading.", "WORKSHEET_REQUIRED");
  }
  const worksheet = workbook.getWorksheet(worksheetName);
  if (!worksheet) throw new HttpError(400, "The selected worksheet is not available in this workbook.", "INVALID_WORKSHEET");
  return { content: worksheetCsv(worksheet), worksheet: worksheet.name };
}

function cellText(cell) {
  if (cell.value == null) return "";
  const value = cell.value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      if (value.result == null) throw new HttpError(400, "This worksheet contains a formula without a saved result. Recalculate the workbook in Excel and upload it again.", "WORKBOOK_FORMULA_UNAVAILABLE");
      return String(value.result);
    }
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if (typeof value.text === "string") return value.text;
    if ("error" in value) throw new HttpError(400, "This worksheet contains an Excel error cell. Correct it before uploading.", "WORKBOOK_CELL_ERROR");
  }
  throw new HttpError(400, "This worksheet contains an unsupported cell value.", "WORKBOOK_CELL_UNSUPPORTED");
}

function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }

function worksheetCsv(worksheet) {
  if (!worksheet || worksheet.rowCount < 1 || worksheet.columnCount < 1) {
    throw new HttpError(400, "Choose a worksheet that contains a header row and data.", "EMPTY_WORKSHEET");
  }
  if (worksheet.rowCount > MAX_CSV_ROWS + 1 || worksheet.columnCount > MAX_CSV_COLUMNS) {
    throw new HttpError(413, `Worksheets may contain at most ${MAX_CSV_ROWS} data rows and ${MAX_CSV_COLUMNS} columns.`, "WORKSHEET_TOO_LARGE");
  }
  const rows = [];
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rows.push(Array.from({ length: worksheet.columnCount }, (_, index) => csvCell(cellText(row.getCell(index + 1)))).join(","));
  }
  const content = rows.join("\n");
  if (Buffer.byteLength(content, "utf8") > MAX_CSV_BYTES) {
    throw new HttpError(413, `The selected worksheet expands beyond the ${MAX_CSV_BYTES}-byte upload limit.`, "UPLOAD_TOO_LARGE");
  }
  return content;
}

export async function uploadWorkbook(file, worksheetName, desiredTableName, workspaceId, options) {
  const workbook = await readWorkbook(file);
  if (typeof worksheetName !== "string" || !worksheetName.trim()) {
    throw new HttpError(400, "Choose a worksheet from the workbook before uploading.", "WORKSHEET_REQUIRED");
  }
  const worksheet = workbook.getWorksheet(worksheetName);
  if (!worksheet) throw new HttpError(400, "The selected worksheet is not available in this workbook.", "INVALID_WORKSHEET");
  const csv = worksheetCsv(worksheet);
  const bytes = Buffer.from(csv, "utf8");
  const syntheticCsv = {
    name: `${file.name.replace(/\.xlsx$/i, "")}.csv`,
    type: "text/csv",
    size: bytes.byteLength,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
  };
  return {
    ...(await uploadCsv(syntheticCsv, desiredTableName, workspaceId, options)),
    source: { file_name: file.name, worksheet: worksheet.name, format: "xlsx" },
  };
}
