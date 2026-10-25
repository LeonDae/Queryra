import { getSchemaMetadata, getTableNames } from "./db.js";
import { HttpError } from "./http-error.js";
import { consumeRateLimit, withConcurrencyLimit } from "./resource-controls.js";

const DEFAULT_GEMINI_MODEL = "models/gemini-2.5-flash";

async function callGemini(prompt) {
  if (!process.env.GOOGLE_API_KEY) throw new HttpError(503, "Gemini is not configured on this server.", "PROVIDER_CONFIGURATION");
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  if (!/^models\/[a-z0-9.-]+$/i.test(model)) throw new HttpError(503, "GEMINI_MODEL must be a valid Gemini model identifier such as models/gemini-2.5-flash.", "PROVIDER_CONFIGURATION");
  consumeRateLimit("gemini", "GEMINI_REQUESTS_PER_MINUTE", 20, 60_000, 1_000);
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent`;
  return withConcurrencyLimit("gemini", "PROVIDER_CONCURRENCY", 2, async () => {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GOOGLE_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new HttpError(504, "Gemini request timed out. Try again later.", "PROVIDER_TIMEOUT");
      throw new HttpError(502, "Could not connect to Gemini. Check network access and try again.", "PROVIDER_UNAVAILABLE");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) throw new HttpError(429, "Gemini quota or rate limit reached. Try again later or check provider usage.", "PROVIDER_RATE_LIMITED");
      if (response.status >= 500) throw new HttpError(502, "Gemini is temporarily unavailable. Try again later.", "PROVIDER_UNAVAILABLE");
      throw new HttpError(502, "Gemini rejected the request. Verify the API key, model access, and request configuration.", "PROVIDER_REQUEST_REJECTED");
    }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new HttpError(502, "Gemini returned an empty or unsupported response.", "PROVIDER_INVALID_RESPONSE");
    const usage = data?.usageMetadata;
    const providerUsage = usage ? {
      promptTokens: Number.isFinite(usage.promptTokenCount) ? usage.promptTokenCount : null,
      completionTokens: Number.isFinite(usage.candidatesTokenCount) ? usage.candidatesTokenCount : null,
      totalTokens: Number.isFinite(usage.totalTokenCount) ? usage.totalTokenCount : null,
    } : null;
    return { text: text.trim(), providerUsage };
  });
}

function cleanSql(value) {
  let sql = value.trim();
  if (sql.startsWith("```")) sql = sql.split("```")[1]?.replace(/^sql\s*/i, "").trim() ?? sql;
  sql = sql.replaceAll("\\n", " ").trim();
  return sql.endsWith(";") ? sql : `${sql};`;
}

export async function resolveSchema(body) {
  if (body.schemaMode === "custom") {
    if (!body.customSchema?.trim()) throw new HttpError(400, "customSchema is required when schemaMode='custom'.", "INVALID_SCHEMA");
    return body.customSchema.trim();
  }
  if (body.schemaMode === "selected_tables") {
    if (!body.selectedTables?.length) throw new HttpError(400, "selectedTables is required when schemaMode='selected_tables'.", "INVALID_SCHEMA");
    const available = new Set((await getTableNames()).map((name) => name.toLowerCase()));
    if (body.selectedTables.some((name) => !available.has(String(name).toLowerCase()))) {
      throw new HttpError(400, "One or more selected tables are unavailable.", "INVALID_RELATION");
    }
    return getSchemaMetadata(body.selectedTables);
  }
  return getSchemaMetadata();
}

export async function generateSql(question, schema, pipeline = "llm") {
  let candidate;
  const providerUsage = {};
  if (pipeline === "slm_review") {
    const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
    consumeRateLimit("ollama", "OLLAMA_REQUESTS_PER_MINUTE", 20, 60_000, 1_000);
    let response;
    try {
      response = await withConcurrencyLimit("ollama", "PROVIDER_CONCURRENCY", 2, () => fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b", stream: false, messages: [{ role: "user", content: `You are a SQL query generator. Return only SQL, use only the given schema, and write a SELECT query.\n\nSchema:\n${schema}\n\nUser query:\n${question}` }] }),
        signal: AbortSignal.timeout(120_000),
      }));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new HttpError(504, "The local model request timed out.", "LOCAL_MODEL_TIMEOUT");
      throw new HttpError(502, "Could not connect to the configured local model endpoint.", "LOCAL_MODEL_UNAVAILABLE");
    }
    if (!response.ok) {
      if (response.status === 429) throw new HttpError(429, "The local model endpoint is busy. Try again later.", "LOCAL_MODEL_BUSY");
      throw new HttpError(502, "The local model endpoint rejected the request. Check Ollama connectivity and model availability.", "LOCAL_MODEL_UNAVAILABLE");
    }
    const data = await response.json();
    candidate = data?.message?.content?.trim();
    if (!candidate) throw new HttpError(502, "The local model returned an empty or unsupported response.", "LOCAL_MODEL_INVALID_RESPONSE");
    if (Number.isFinite(data.prompt_eval_count) || Number.isFinite(data.eval_count)) {
      providerUsage.ollama = { promptTokens: data.prompt_eval_count ?? null, completionTokens: data.eval_count ?? null };
    }
    const review = await callGemini(`You are a SQL reviewer. Correct the candidate if needed. Return only SQL.\n\nUser question:\n${question}\n\nDatabase schema:\n${schema}\n\nCandidate SQL:\n${candidate}`);
    candidate = review.text;
    if (review.providerUsage) providerUsage.gemini = review.providerUsage;
  } else {
    const response = await callGemini(`You are a SQL query generator. Return only a SQL query.\nRules: only SELECT queries; use only the supplied schema; no explanation, comments, or markdown.\n\nSchema:\n${schema}\n\nUser query:\n${question}`);
    candidate = response.text;
    if (response.providerUsage) providerUsage.gemini = response.providerUsage;
  }
  return { sql: cleanSql(candidate), providerUsage: Object.keys(providerUsage).length ? providerUsage : null };
}

export async function regenerateSql(question, previousSql, feedback, schema) {
  const output = await callGemini(`You are an expert SQL query generator. Modify the SQL strictly based on the feedback. Return only raw SELECT SQL, with no markdown or explanation.\n\nUser question:\n${question}\n\nDatabase schema:\n${schema}\n\nPrevious SQL:\n${previousSql}\n\nUser feedback:\n${feedback}`);
  return { sql: cleanSql(output.text), providerUsage: output.providerUsage ? { gemini: output.providerUsage } : null };
}
