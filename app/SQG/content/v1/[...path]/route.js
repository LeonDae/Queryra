import { NextResponse } from "next/server";
import { checkDatabaseHealth, deleteTable, executeSelect, getSchemaMetadata, getTableNames } from "../../../../../lib/db.js";
import { HttpError } from "../../../../../lib/http-error.js";
import { MAX_CSV_BYTES, parseCsvData, uploadCsv } from "../../../../../lib/csv.js";
import { getWorkbookSheetNames, uploadWorkbook, workbookToCsv } from "../../../../../lib/workbook.js";
import { generateSql, regenerateSql, resolveSchema } from "../../../../../lib/sql.js";
import { runGuestQuery } from "../../../../../lib/guest-query.js";
import { clearGuestCookie, deleteGuestSession, getGuestSession, loadGuestDataset, saveGuestDataset, setGuestCookie } from "../../../../../lib/guest-sessions.js";
import { z } from "zod";
import { deleteTableRequestSchema, executeRequestSchema, feedbackRequestSchema, generateRequestSchema, schemaStudioRequestSchema } from "../../../../../lib/api-schemas.js";
import { consumeRateLimit, withConcurrencyLimit } from "../../../../../lib/resource-controls.js";
import { assertSameOriginMutation } from "../../../../../lib/request-security.js";
import { requireWorkspace } from "../../../../../lib/supabase/auth.js";
import { executeCreateTable, validateCreateTable } from "../../../../../lib/schema-studio.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_JSON_BODY_BYTES = 256 * 1024;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

function normalizedCsv(parsed) {
  return [parsed.columns, ...parsed.data].map((row) => parsed.columns.map((_, index) => csvCell(row[index])).join(",")).join("\n");
}

function safeUploadName(name) {
  const basename = String(name || "dataset.csv").replaceAll("\\", "/").split("/").pop() || "dataset.csv";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "dataset.csv";
}

function errorResponse(error) {
  if (error instanceof HttpError) return json({ detail: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError) {
    const detail = error.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
    return json({ detail, code: "INVALID_REQUEST" }, 400);
  }
  console.error("Unhandled API error:", error?.message || "unknown error");
  return json({ detail: "An unexpected server error occurred.", code: "INTERNAL_ERROR" }, 500);
}

async function readBoundedBody(request, maximumBytes) {
  const announced = Number(request.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > maximumBytes) throw new HttpError(413, "Request body exceeds the configured size limit.", "BODY_TOO_LARGE");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "Request body exceeds the configured size limit.", "BODY_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function readJson(request) {
  const body = await readBoundedBody(request, MAX_JSON_BODY_BYTES);
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw new HttpError(400, "Request body must be valid JSON.", "INVALID_JSON"); }
}

async function readForm(request) {
  const body = await readBoundedBody(request, 10 * 1024 * 1024 + 64 * 1024);
  try {
    const cloned = new Request(request.url, { method: "POST", headers: request.headers, body });
    return await cloned.formData();
  } catch {
    throw new HttpError(400, "Upload form is invalid or corrupted.", "INVALID_UPLOAD");
  }
}

export async function GET(_request, context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  try {
    if (endpoint === "health") {
      return json(await checkDatabaseHealth());
    }
    if (endpoint === "tables") { const { workspaceId } = await requireWorkspace(); return json({ tables: await getTableNames(workspaceId) }); }
    if (endpoint === "schema") { const { workspaceId } = await requireWorkspace(); return json({ schema_text: await getSchemaMetadata(undefined, workspaceId) }); }
    return json({ detail: "Not found." }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  let guestCookieSession = null;
  try {
    assertSameOriginMutation(request);
    if (endpoint === "guest-workbook-sheets") {
      consumeRateLimit("guest-workbook-inspection", "CSV_UPLOADS_PER_10_MINUTES", 20, 10 * 60_000, 100);
      const form = await readForm(request);
      const worksheets = await withConcurrencyLimit(
        "guest-workbook-parse", "DB_INGEST_CONCURRENCY", 2,
        () => getWorkbookSheetNames(form.get("file")), 10,
        { code: "GUEST_CAPACITY", message: "The file service is busy. Try again shortly." },
      );
      return json({ worksheets });
    }
    if (endpoint === "guest-clear") {
      try {
        const session = await getGuestSession(request);
        await deleteGuestSession(session.id);
      } catch (error) {
        if (error?.code !== "GUEST_SESSION_EXPIRED") throw error;
      }
      return clearGuestCookie(json({ cleared: true }));
    }
    if (endpoint === "guest-ask") {
      consumeRateLimit("guest-query", "GEMINI_REQUESTS_PER_MINUTE", 20, 60_000, 1_000);
      const form = await readForm(request);
      const question = form.get("question");
      if (typeof question !== "string" || !question.trim() || question.length > 8_000) throw new HttpError(400, "Enter a question up to 8,000 characters.", "INVALID_QUESTION");
      const uploadedFile = form.get("file");
      const hasFile = uploadedFile && typeof uploadedFile.arrayBuffer === "function";
      const session = await getGuestSession(request, { create: Boolean(hasFile) });
      guestCookieSession = session;

      if (hasFile) {
        if (uploadedFile.size > MAX_CSV_BYTES) throw new HttpError(413, "Files must be no larger than 10 MB.", "UPLOAD_TOO_LARGE");
        const filename = safeUploadName(uploadedFile.name);
        const isWorkbook = filename.toLowerCase().endsWith(".xlsx");
        let content;
        let worksheet = null;
        if (isWorkbook) {
          const selected = form.get("worksheet_name");
          if (typeof selected !== "string") throw new HttpError(400, "Choose a worksheet from the workbook.", "WORKSHEET_REQUIRED");
          ({ content, worksheet } = await workbookToCsv(uploadedFile, selected));
        } else {
          if (!filename.toLowerCase().endsWith(".csv")) throw new HttpError(400, "Choose a valid .csv file or .xlsx workbook.", "INVALID_FILE_TYPE");
          const mimeType = String(uploadedFile.type || "").split(";")[0].trim().toLowerCase();
          if (mimeType && !["text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"].includes(mimeType)) {
            throw new HttpError(400, "Choose a valid .csv file.", "INVALID_FILE_TYPE");
          }
          content = Buffer.from(await uploadedFile.arrayBuffer()).toString("utf8");
        }
        const parsed = parseCsvData(content);
        const cleanContent = normalizedCsv(parsed);
        if (Buffer.byteLength(cleanContent, "utf8") > MAX_CSV_BYTES) throw new HttpError(413, "The normalized file exceeds the 10 MB session limit.", "UPLOAD_TOO_LARGE");
        await saveGuestDataset(session.id, cleanContent, {
          fileName: filename,
          worksheet,
          rowCount: parsed.data.length,
          columns: parsed.columns,
        });
      }

      const dataset = await loadGuestDataset(session.id);
      const startedAt = performance.now();
      const result = await withConcurrencyLimit(
        "guest-duckdb", "DB_QUERY_CONCURRENCY", 3,
        () => runGuestQuery({ csvPath: dataset.csvPath, question: question.trim() }), 10,
        { code: "GUEST_CAPACITY", message: "Queryra Web is at capacity. Try again shortly." },
      );
      const response = json({
        ...result,
        durationMs: Math.round(performance.now() - startedAt),
        dataset: { ...dataset.metadata, columns: dataset.metadata.columns },
      });
      return setGuestCookie(response, session);
    }

    const { workspaceId } = await requireWorkspace();
    if (endpoint === "upload-csv") {
      consumeRateLimit("csv-upload", "CSV_UPLOADS_PER_10_MINUTES", 3, 10 * 60_000, 100);
      const form = await readForm(request);
      const tableName = form.get("table_name");
      if (tableName !== null && typeof tableName !== "string") throw new HttpError(400, "table_name must be a text field.", "INVALID_REQUEST");
      const result = await withConcurrencyLimit(
        "database-ingest",
        "DB_INGEST_CONCURRENCY",
        1,
          () => uploadCsv(form.get("file"), tableName, workspaceId),
        10,
        { code: "INGEST_CAPACITY", message: "The CSV ingestion service is at capacity. Try again shortly." },
      );
      return json(result);
    }
    if (endpoint === "workbook-sheets") {
      const form = await readForm(request);
      consumeRateLimit("workbook-inspection", "CSV_UPLOADS_PER_10_MINUTES", 3, 10 * 60_000, 100);
      const worksheets = await withConcurrencyLimit(
        "workbook-parse",
        "DB_INGEST_CONCURRENCY",
        1,
        () => getWorkbookSheetNames(form.get("file")),
        10,
        { code: "INGEST_CAPACITY", message: "The workbook service is at capacity. Try again shortly." },
      );
      return json({ worksheets });
    }
    if (endpoint === "upload-workbook") {
      consumeRateLimit("csv-upload", "CSV_UPLOADS_PER_10_MINUTES", 3, 10 * 60_000, 100);
      const form = await readForm(request);
      const worksheetName = form.get("worksheet_name");
      const tableName = form.get("table_name");
      if (typeof worksheetName !== "string") throw new HttpError(400, "worksheet_name must be a text field.", "INVALID_REQUEST");
      if (tableName !== null && typeof tableName !== "string") throw new HttpError(400, "table_name must be a text field.", "INVALID_REQUEST");
      const result = await withConcurrencyLimit(
        "database-ingest",
        "DB_INGEST_CONCURRENCY",
        1,
        () => uploadWorkbook(form.get("file"), worksheetName, tableName, workspaceId),
        10,
        { code: "INGEST_CAPACITY", message: "The dataset ingestion service is at capacity. Try again shortly." },
      );
      return json(result);
    }

    const body = await readJson(request);
    if (endpoint === "delete-table") {
      consumeRateLimit("table-delete", "CSV_UPLOADS_PER_10_MINUTES", 10, 10 * 60_000, 100);
      const input = deleteTableRequestSchema.parse(body);
      const result = await withConcurrencyLimit(
        "database-ingest",
        "DB_INGEST_CONCURRENCY",
        1,
        () => deleteTable(input.tableName, workspaceId),
        10,
        { code: "INGEST_CAPACITY", message: "The database service is busy. Try again shortly." },
      );
      return json(result);
    }

    if (endpoint === "schema-studio/validate") {
      const input = schemaStudioRequestSchema.parse(body);
      const validated = validateCreateTable(input.sql);
      return json({ valid: true, ...validated });
    }

    if (endpoint === "schema-studio/execute") {
      consumeRateLimit("schema-studio", "CSV_UPLOADS_PER_10_MINUTES", 3, 10 * 60_000, 100);
      const input = schemaStudioRequestSchema.parse(body);
      const result = await withConcurrencyLimit(
        "database-ingest",
        "DB_INGEST_CONCURRENCY",
        1,
        () => executeCreateTable(input.sql, workspaceId),
        10,
        { code: "INGEST_CAPACITY", message: "The schema service is at capacity. Try again shortly." },
      );
      return json(result);
    }

    if (endpoint === "generate-sql") {
      const input = generateRequestSchema.parse(body);
      const schema = await resolveSchema(input, workspaceId);
      if (schema.length > 100_000) throw new HttpError(413, "Schema context exceeds the configured size limit.", "SCHEMA_TOO_LARGE");
      const generated = await generateSql(input.question, schema, input.pipeline);
      return json({ originalQuestion: input.question, generatedSQL: generated.sql, providerUsage: generated.providerUsage });
    }

    if (endpoint === "execute-sql") {
      const input = executeRequestSchema.parse(body);
      const startedAt = performance.now();
      const result = await executeSelect(input.generatedSQL, input.selectedTables, workspaceId);
      return json({ originalQuestion: input.originalQuestion, generatedSQL: input.generatedSQL, rows: result.rows, rowCount: result.rows.length, durationMs: Math.round(performance.now() - startedAt), truncated: result.truncated, rowLimit: result.rowLimit });
    }

    if (endpoint === "feedback") {
      const input = feedbackRequestSchema.parse(body);
      if (input.satisfied) return json({ message: "Feedback received. No regeneration required.", regeneratedSQL: null });
      const schema = await resolveSchema(input, workspaceId);
      if (schema.length > 100_000) throw new HttpError(413, "Schema context exceeds the configured size limit.", "SCHEMA_TOO_LARGE");
      const regenerated = await regenerateSql(input.originalQuestion, input.generatedSQL, input.feedback, schema);
      return json({ message: "SQL regenerated based on feedback.", regeneratedSQL: regenerated.sql, providerUsage: regenerated.providerUsage });
    }
    return json({ detail: "Not found." }, 404);
  } catch (error) {
    const response = errorResponse(error);
    if (guestCookieSession) setGuestCookie(response, guestCookieSession);
    return response;
  }
}
