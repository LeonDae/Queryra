import { readConfig, resolveGeminiKey } from "./config.js";
import { validateCliSelect } from "./sql-safety.js";
import { unsupportedFieldError } from "./question-guard.js";
import { CliError } from "./errors.js";

const DEFAULT_MODEL = "models/gemini-2.5-flash";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

export async function generateSql(question, schema, { environment = process.env, config, fetchImpl = fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, tableName = "queryra_data", columns = [], onStatus } = {}) {
  const settings = config ?? (environment.QUERYRA_GEMINI_API_KEY ? {} : await readConfig());
  const apiKey = resolveGeminiKey(settings, environment);
  if (!apiKey) throw new CliError("Gemini is not configured. Run `queryra init` or set QUERYRA_GEMINI_API_KEY.", 3);
  const model = environment.QUERYRA_GEMINI_MODEL || DEFAULT_MODEL;
  if (!/^models\/[a-z0-9.-]+$/i.test(model)) throw new CliError("QUERYRA_GEMINI_MODEL must be a valid Gemini model identifier.", 3);
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: `Answer the question using only the provided DuckDB schema. Never invent a column, value, or data. If a requested field is not present or the question cannot be answered from the schema, return exactly: UNSUPPORTED: <missing field names>. If the question is ambiguous, return exactly: CLARIFY: <one short clarification question>. Otherwise return exactly one read-only SQL SELECT query using only relation public.${tableName}, ordinary aggregate/date/scalar functions, and the supplied schema. Do not substitute an unrelated query when a requested field is missing. Return raw SQL without markdown or explanation.\n\nSchema:\n${schema}\n\nQuestion:\n${question}` }] }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new CliError("Gemini request timed out. Try again later.", 4);
    throw new CliError("Could not connect to Gemini. Check network access and try again.", 4);
  }
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new CliError("Gemini request timed out. Try again later.", 4);
    throw new CliError("Gemini returned an invalid response.", 4);
  }
  if (!response.ok) {
    if (response.status === 429) throw new CliError("Gemini quota or rate limit reached. Check your own API key and provider quota.", 4);
    if (response.status === 401 || response.status === 403) throw new CliError("Gemini rejected the configured API key or its model access.", 4);
    if (response.status >= 500) throw new CliError("Gemini is temporarily unavailable. Try again later.", 4);
    throw new CliError("Gemini rejected the request. Check the selected model and request configuration.", 4);
  }
  const candidate = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof candidate !== "string" || !candidate.trim()) throw new CliError("Gemini returned an empty or unsupported response.", 4);
  const cleaned = candidate.replace(/^```(?:sql|text)?\s*/i, "").replace(/\s*```$/, "").trim();
  const unsupported = cleaned.match(/^UNSUPPORTED\s*:\s*(.+)$/i);
  if (unsupported) throw unsupportedFieldError(unsupported[1].split(/\s*,\s*/), schema, columns);
  const clarification = cleaned.match(/^CLARIFY\s*:\s*(.+)$/i);
  if (clarification) {
    const question = clarification[1].replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
    throw new CliError(`Please clarify your question: ${question}`, 5);
  }
  onStatus?.("SQL safety validation");
  return { sql: validateCliSelect(cleaned, tableName), providerUsage: payload.usageMetadata ?? null };
}
