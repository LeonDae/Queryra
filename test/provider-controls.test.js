import test from "node:test";
import assert from "node:assert/strict";
import { generateSql } from "../lib/sql.js";

const previousEnv = new Map();
for (const name of ["GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_REQUESTS_PER_MINUTE", "OLLAMA_REQUESTS_PER_MINUTE", "PROVIDER_CONCURRENCY"]) {
  previousEnv.set(name, process.env[name]);
}
process.env.GOOGLE_API_KEY = "test-key-not-used-on-network";
process.env.GEMINI_REQUESTS_PER_MINUTE = "1000";
process.env.OLLAMA_REQUESTS_PER_MINUTE = "1000";
process.env.PROVIDER_CONCURRENCY = "1";

test.after(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function geminiResponse({ status = 200, body } = {}) {
  const payload = body ?? {
    candidates: [{ content: { parts: [{ text: "SELECT 1" }] } }],
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 3,
      totalTokenCount: 14,
      cachedContentTokenCount: 2,
      thoughtsTokenCount: 1,
      toolUsePromptTokenCount: 4,
      promptTokensDetails: [{ modality: "TEXT", tokenCount: 11 }],
      candidatesTokensDetails: [{ modality: "TEXT", tokenCount: 3 }],
    },
  };
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("maps Gemini quota responses and recovers for a later request", async () => {
  let calls = 0;
  const fetchImpl = async () => ++calls === 1 ? geminiResponse({ status: 429 }) : geminiResponse();
  await assert.rejects(generateSql("question", "schema", "llm", { fetchImpl }), (error) => error.status === 429 && error.code === "PROVIDER_RATE_LIMITED");
  const result = await generateSql("question", "schema", "llm", { fetchImpl });
  assert.equal(calls, 2);
  assert.equal(result.sql, "SELECT 1;");
  assert.deepEqual(result.providerUsage.gemini, {
    promptTokens: 11,
    completionTokens: 3,
    totalTokens: 14,
    cachedContentTokens: 2,
    thoughtsTokens: 1,
    toolUsePromptTokens: 4,
    promptTokenDetails: [{ modality: "TEXT", tokenCount: 11 }],
    completionTokenDetails: [{ modality: "TEXT", tokenCount: 3 }],
  });
});

test("maps provider timeouts and releases concurrency for recovery", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return geminiResponse();
  };
  await assert.rejects(generateSql("question", "schema", "llm", { fetchImpl }), (error) => error.status === 504 && error.code === "PROVIDER_TIMEOUT");
  const result = await generateSql("question", "schema", "llm", { fetchImpl });
  assert.equal(result.sql, "SELECT 1;");
  assert.equal(calls, 2);
});

test("maps an aborted provider response body to timeout instead of invalid JSON", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw Object.assign(new Error("aborted while reading body"), { name: "AbortError" }); },
  });
  await assert.rejects(generateSql("question", "schema", "llm", { fetchImpl }), (error) => error.status === 504 && error.code === "PROVIDER_TIMEOUT");
});

test("maps invalid provider response JSON to a sanitized error", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad JSON"); } });
  await assert.rejects(generateSql("question", "schema", "llm", { fetchImpl }), (error) => error.status === 502 && error.code === "PROVIDER_INVALID_RESPONSE");
});

test("does not invent provider usage when an upstream omits usage metadata", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: "SELECT 1" }] } }] }),
  });
  const result = await generateSql("question", "schema", "llm", { fetchImpl });
  assert.equal(result.providerUsage, null);
});

test("preserves actual Ollama usage and Gemini review usage", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, status: 200, json: async () => ({ message: { content: "SELECT 1" }, prompt_eval_count: 21, eval_count: 5, total_duration: 100, load_duration: 20, prompt_eval_duration: 30, eval_duration: 50 }) };
    return geminiResponse();
  };
  const result = await generateSql("question", "schema", "slm_review", { fetchImpl });
  assert.equal(calls, 2);
  assert.deepEqual(result.providerUsage, {
    ollama: { promptTokens: 21, completionTokens: 5, totalDurationNs: 100, loadDurationNs: 20, promptDurationNs: 30, completionDurationNs: 50 },
    gemini: {
      promptTokens: 11,
      completionTokens: 3,
      totalTokens: 14,
      cachedContentTokens: 2,
      thoughtsTokens: 1,
      toolUsePromptTokens: 4,
      promptTokenDetails: [{ modality: "TEXT", tokenCount: 11 }],
      completionTokenDetails: [{ modality: "TEXT", tokenCount: 3 }],
    },
  });
});

test("maps Ollama timeouts and recovers provider capacity", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    if (calls === 2) return { ok: true, status: 200, json: async () => ({ message: { content: "SELECT 1" } }) };
    return geminiResponse();
  };
  await assert.rejects(generateSql("question", "schema", "slm_review", { fetchImpl }), (error) => error.status === 504 && error.code === "LOCAL_MODEL_TIMEOUT");
  const result = await generateSql("question", "schema", "slm_review", { fetchImpl });
  assert.equal(result.sql, "SELECT 1;");
  assert.equal(calls, 3);
});

test("maps Ollama overload responses to a retryable quota error", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(generateSql("question", "schema", "slm_review", { fetchImpl }), (error) => error.status === 429 && error.code === "LOCAL_MODEL_BUSY");
});
