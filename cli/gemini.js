import { readConfig, resolveGeminiKey } from "./config.js";
import { validateCliSelect } from "./sql-safety.js";
import { unsupportedFieldError } from "./question-guard.js";
import { CliError } from "./errors.js";

const DEFAULT_MODEL = "models/gemini-2.5-flash";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;

function sanitizeProviderMessage(message, apiKey) {
  if (typeof message !== "string" || !message.trim()) return "No provider message was supplied.";
  return message
    .replaceAll(apiKey, "[redacted]")
    .replace(/(?:AIza[\w-]{20,})/g, "[redacted]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function providerError(response, payload, apiKey) {
  const status = response.status;
  const detail = sanitizeProviderMessage(payload?.error?.message, apiKey);
  const categories = {
    400: ["Invalid request", "Review the model and generation request."],
    401: ["Authentication failure", "Check that the Gemini API key is valid and active."],
    403: ["Permission or API access failure", "Check Gemini API access and key restrictions in Google AI Studio."],
    404: ["Model or endpoint not found", "Check QUERYRA_GEMINI_MODEL and model availability."],
    429: ["Quota or rate limit", "Check the Google AI Studio project quota and retry later."],
    500: ["Gemini provider failure", "Retry later."],
    503: ["Gemini provider unavailable", "Retry later."],
  };
  const [category, action] = categories[status] ?? (status >= 500
    ? ["Gemini provider failure", "Retry later."]
    : ["Gemini request failure", "Review the model and request configuration."]);
  return new CliError(`Gemini ${category} (HTTP ${status}). ${detail} Recommended action: ${action}`, 4, { cause: new Error(`Gemini HTTP ${status}: ${detail}`) });
}

async function requestGemini({ apiKey, model, contents, fetchImpl, timeoutMs, maxOutputTokens = 256 }) {
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    throw new CliError(timedOut
      ? "Gemini request timed out. Check your connection and retry."
      : "Could not connect to Gemini (network error). Check network access and retry.", 4, { cause: error });
  }
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    throw new CliError(`Gemini returned an invalid response (HTTP ${response.status}).`, 4, { cause: error });
  }
  if (!response.ok) throw providerError(response, payload, apiKey);
  return payload;
}

export async function validateGeminiConnection({ apiKey, environment = process.env, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new CliError("Enter a Gemini API key to validate it.", 3);
  const model = environment.QUERYRA_GEMINI_MODEL || DEFAULT_MODEL;
  if (!/^models\/[a-z0-9.-]+$/i.test(model)) throw new CliError("QUERYRA_GEMINI_MODEL must be a valid Gemini model identifier.", 3);
  await requestGemini({
    apiKey: apiKey.trim(), model, fetchImpl, timeoutMs, maxOutputTokens: 1,
    contents: [{ parts: [{ text: "Reply with OK." }] }],
  });
  return true;
}

export async function generateSql(question, schema, { environment = process.env, config, fetchImpl = fetch, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS, tableName = "queryra_data", columns = [], onStatus } = {}) {
  const settings = config ?? (environment.QUERYRA_GEMINI_API_KEY ? {} : await readConfig());
  const apiKey = resolveGeminiKey(settings, environment);
  if (!apiKey) throw new CliError("Gemini is not configured. Run `queryra init` or set QUERYRA_GEMINI_API_KEY.", 3);
  const model = environment.QUERYRA_GEMINI_MODEL || DEFAULT_MODEL;
  if (!/^models\/[a-z0-9.-]+$/i.test(model)) throw new CliError("QUERYRA_GEMINI_MODEL must be a valid Gemini model identifier.", 3);
  const payload = await requestGemini({
    apiKey, model, fetchImpl, timeoutMs, maxOutputTokens: 1024,
    contents: [{ parts: [{ text: `Answer the question using only the provided DuckDB schema. Never invent a column, value, or data. If a requested field is not present or the question cannot be answered from the schema, return exactly: UNSUPPORTED: <missing field names>. If the question is ambiguous, return exactly: CLARIFY: <one short clarification question>. Otherwise return exactly one read-only SQL SELECT query using only relation public.${tableName}, ordinary aggregate/date/scalar functions, and the supplied schema. Do not substitute an unrelated query when a requested field is missing. Return raw SQL without markdown or explanation.\n\nSchema:\n${schema}\n\nQuestion:\n${question}` }] }],
  });
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
