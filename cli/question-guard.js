import { CliError } from "./errors.js";

const FIELD_STOP_WORDS = new Set([
  "a", "an", "the", "by", "per", "for", "each", "and", "or", "with", "of", "in", "on",
  "total", "average", "avg", "sum", "count", "maximum", "minimum", "max", "min", "group", "grouped",
  "broken", "down", "sorted", "ordered", "ascending", "descending", "highest", "lowest",
]);
const LIKELY_FIELD_ATTRIBUTES = new Set([
  "age", "birth", "birthdate", "city", "country", "department", "dob", "email", "gender", "height",
  "name", "phone", "postal", "salary", "state", "status", "type", "weight", "zip",
]);

function normalizeWords(value) {
  return String(value || "").toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/).filter(Boolean);
}

export function parseSchemaColumnNames(schema, explicitColumns = []) {
  const names = Array.isArray(explicitColumns) && explicitColumns.length
    ? explicitColumns
    : String(schema || "").split(/\r?\n/).map((line) => line.trim().split(/\s+(?=[A-Z][A-Z0-9_]*(?:\(|\b))/i)[0]).filter(Boolean);
  return [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
}

function availableColumns(columns) {
  if (!columns.length) return "No columns were discovered.";
  const shown = columns.slice(0, 20).map((column) => `\"${safeFieldName(column)}\"`);
  const suffix = columns.length > shown.length ? `, and ${columns.length - shown.length} more` : "";
  return `Available columns: ${shown.join(", ")}${suffix}.`;
}

function safeFieldName(value) {
  return String(value || "requested field").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) || "requested field";
}

export function unsupportedFieldError(fields, schema, columns = []) {
  const available = availableColumns(parseSchemaColumnNames(schema, columns));
  const missing = [...new Set((Array.isArray(fields) ? fields : [fields]).map(safeFieldName))];
  const label = missing.length ? missing.map((field) => `\"${field}\"`).join(", ") : "the requested field";
  return new CliError(`The selected CSV does not contain ${label}. ${available} Choose a dataset with that information or rephrase your question using available fields.`, 5);
}

/**
 * Catch high-confidence missing group-by dimensions/attributes before asking Gemini.
 * Gemini is also explicitly instructed to return UNSUPPORTED/CLARIFY markers;
 * DuckDB EXPLAIN remains the authoritative SQL column binder before execution.
 */
export function assertQuestionDimensions(question, schema, columns = []) {
  const available = parseSchemaColumnNames(schema, columns);
  if (!available.length) return;
  const knownWords = new Set(available.flatMap(normalizeWords));
  const pattern = /\b(?:group(?:ed)?\s+by|broken\s+down\s+by|by|per|for\s+each)\s+(.+?)(?=\b(?:sorted|ordered|including|where|with|show)\b|[?.!;]|$)/i;
  const match = String(question || "").match(pattern);
  if (!match) return;

  const dimensions = match[1].split(/\s*(?:,|\band\b|\bor\b)\s*/i).map((value) => value.trim()).filter(Boolean);
  for (const dimension of dimensions) {
    const words = normalizeWords(dimension).filter((word) => !FIELD_STOP_WORDS.has(word));
    if (!words.length || available.some((column) => normalizeWords(column).join(" ") === words.join(" "))) continue;
    const missing = words.filter((word) => !knownWords.has(word));
    if (missing.some((word) => LIKELY_FIELD_ATTRIBUTES.has(word))) {
      throw unsupportedFieldError([dimension], schema, available);
    }
  }
}
