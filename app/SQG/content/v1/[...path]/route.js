import { NextResponse } from "next/server";
import { executeSelect, getPool, getSchemaMetadata, getTableNames } from "../../../../../lib/db.js";
import { HttpError } from "../../../../../lib/http-error.js";
import { uploadCsv } from "../../../../../lib/csv.js";
import { generateSql, regenerateSql, resolveSchema } from "../../../../../lib/sql.js";
import { z } from "zod";
import { executeRequestSchema, feedbackRequestSchema, generateRequestSchema } from "../../../../../lib/api-schemas.js";
import { consumeRateLimit } from "../../../../../lib/resource-controls.js";
import { assertSameOriginMutation } from "../../../../../lib/request-security.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_JSON_BODY_BYTES = 256 * 1024;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
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
    throw new HttpError(400, "CSV upload form is invalid.", "INVALID_UPLOAD");
  }
}

export async function GET(_request, context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  try {
    if (endpoint === "health") {
      await getPool("reader").query("SELECT 1");
      return json({ status: "UP", database: "connected" });
    }
    if (endpoint === "tables") return json({ tables: await getTableNames() });
    if (endpoint === "schema") return json({ schema_text: await getSchemaMetadata() });
    return json({ detail: "Not found." }, 404);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request, context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  try {
    assertSameOriginMutation(request);
    if (endpoint === "upload-csv") {
      const form = await readForm(request);
      consumeRateLimit("csv-upload", "CSV_UPLOADS_PER_10_MINUTES", 3, 10 * 60_000, 100);
      const result = await uploadCsv(form.get("file"), form.get("table_name"));
      return json(result);
    }

    const body = await readJson(request);
    if (endpoint === "generate-sql") {
      const input = generateRequestSchema.parse(body);
      const schema = await resolveSchema(input);
      if (schema.length > 100_000) throw new HttpError(413, "Schema context exceeds the configured size limit.", "SCHEMA_TOO_LARGE");
      const generated = await generateSql(input.question, schema, input.pipeline);
      return json({ originalQuestion: input.question, generatedSQL: generated.sql, providerUsage: generated.providerUsage });
    }

    if (endpoint === "execute-sql") {
      const input = executeRequestSchema.parse(body);
      const startedAt = performance.now();
      const result = await executeSelect(input.generatedSQL, input.selectedTables);
      return json({ originalQuestion: input.originalQuestion, generatedSQL: input.generatedSQL, rows: result.rows, rowCount: result.rows.length, durationMs: Math.round(performance.now() - startedAt), truncated: result.truncated, rowLimit: result.rowLimit });
    }

    if (endpoint === "feedback") {
      const input = feedbackRequestSchema.parse(body);
      if (input.satisfied) return json({ message: "Feedback received. No regeneration required.", regeneratedSQL: null });
      const schema = await resolveSchema(input);
      if (schema.length > 100_000) throw new HttpError(413, "Schema context exceeds the configured size limit.", "SCHEMA_TOO_LARGE");
      const regenerated = await regenerateSql(input.originalQuestion, input.generatedSQL, input.feedback, schema);
      return json({ message: "SQL regenerated based on feedback.", regeneratedSQL: regenerated.sql, providerUsage: regenerated.providerUsage });
    }
    return json({ detail: "Not found." }, 404);
  } catch (error) { return errorResponse(error); }
}
