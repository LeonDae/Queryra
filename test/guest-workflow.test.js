import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { runGuestQuery } from "../lib/guest-query.js";
import { deleteGuestSession, getGuestSession, GUEST_SESSION_COOKIE, GUEST_SESSION_TTL_MS, loadGuestDataset, saveGuestDataset } from "../lib/guest-sessions.js";

const csvText = "region,amount\nEast,10\nWest,20\nEast,15\n";
const aggregateSql = "SELECT region, SUM(amount) AS total_sales FROM public.queryra_data GROUP BY region ORDER BY region";

function geminiResponse(sql) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: sql }] } }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 8, totalTokenCount: 19 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("guest CSV data and schema-backed DuckDB results stay in a signed temporary session", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GOOGLE_API_KEY;
  const originalModel = process.env.GEMINI_MODEL;
  globalThis.fetch = async () => geminiResponse(aggregateSql);
  process.env.GOOGLE_API_KEY = "test-only-key";
  process.env.GEMINI_MODEL = "models/gemini-2.5-flash";
  let sessionId;
  try {
    const session = await getGuestSession(new Request("http://localhost:3000"), { create: true });
    sessionId = session.id;
    assert.match(session.token, /^[a-f0-9]{64}\.[A-Za-z0-9_-]+$/);
    await saveGuestDataset(session.id, csvText, { fileName: "guest sales.csv", worksheet: null, rowCount: 3, columns: ["region", "amount"] });
    const request = new Request("http://localhost:3000", { headers: { cookie: `${GUEST_SESSION_COOKIE}=${session.token}` } });
    const resolved = await getGuestSession(request);
    const dataset = await loadGuestDataset(resolved.id);
    assert.equal(dataset.metadata.fileName, "guest sales.csv");
    const result = await runGuestQuery({ csvPath: dataset.csvPath, question: "Show total sales by region" });
    assert.deepEqual(result.rows, [{ region: "East", total_sales: "25" }, { region: "West", total_sales: "20" }]);
    assert.equal(result.rowCount, 2);
    assert.deepEqual(result.providerUsage, { promptTokenCount: 11, candidatesTokenCount: 8, totalTokenCount: 19 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = originalModel;
    if (sessionId) await deleteGuestSession(sessionId);
  }
});

test("guest session signatures are checked and expired sessions are rejected", async () => {
  const session = await getGuestSession(new Request("http://localhost:3000"), { create: true });
  try {
    const damagedToken = `${session.token.slice(0, -1)}${session.token.endsWith("A") ? "B" : "A"}`;
    const damagedRequest = new Request("http://localhost:3000", { headers: { cookie: `${GUEST_SESSION_COOKIE}=${damagedToken}` } });
    await assert.rejects(getGuestSession(damagedRequest), (error) => error.status === 401 && error.code === "GUEST_SESSION_EXPIRED");
    const validRequest = new Request("http://localhost:3000", { headers: { cookie: `${GUEST_SESSION_COOKIE}=${session.token}` } });
    await assert.rejects(getGuestSession(validRequest, { now: Date.now() + GUEST_SESSION_TTL_MS + 1 }), (error) => error.status === 401 && error.code === "GUEST_SESSION_EXPIRED");
  } finally { await deleteGuestSession(session.id); }
});

test("guest query rejects a requested missing field before calling Gemini", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "queryra-guest-test-"));
  const csvPath = path.join(dir, "sales.csv");
  await writeFile(csvPath, csvText);
  let providerCalls = 0;
  try {
    await assert.rejects(runGuestQuery({
      csvPath,
      question: "Show total sales by customer age",
      fetchImpl: async () => { providerCalls += 1; return geminiResponse(aggregateSql); },
    }), /does not contain|Available columns/);
    assert.equal(providerCalls, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("guest query rejects generated SQL that binds to a nonexistent column", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "queryra-guest-test-"));
  const csvPath = path.join(dir, "sales.csv");
  await writeFile(csvPath, csvText);
  const originalKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = "test-only-key";
  try {
    await assert.rejects(runGuestQuery({
      csvPath,
      question: "Show total sales by region",
      fetchImpl: async () => geminiResponse("SELECT customer_age FROM public.queryra_data"),
    }), (error) => error.code === "QUERY_SCHEMA_MISMATCH");
  } finally {
    if (originalKey === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = originalKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("guest query provider failures remain distinct from SQL failures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "queryra-guest-test-"));
  const csvPath = path.join(dir, "sales.csv");
  await writeFile(csvPath, csvText);
  const originalKey = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = "test-only-key";
  try {
    await assert.rejects(runGuestQuery({ csvPath, question: "Show totals", fetchImpl: async () => new Response("{}", { status: 503 }) }), (error) => error.code === "PROVIDER_UNAVAILABLE");
  } finally {
    if (originalKey === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = originalKey;
    await rm(dir, { recursive: true, force: true });
  }
});

test("guest routes remain same-origin guarded and bypass workspace DB routes entirely", () => {
  const route = readFileSync(new URL("../app/SQG/content/v1/[...path]/route.js", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../app/queryra-web-composer.jsx", import.meta.url), "utf8");
  assert.match(route, /assertSameOriginMutation\(request\)[\s\S]*?endpoint === "guest-workbook-sheets"[\s\S]*?endpoint === "guest-ask"[\s\S]*?requireWorkspace\(\)/);
  assert.match(route, /endpoint === "guest-ask"[\s\S]*?getGuestSession[\s\S]*?saveGuestDataset[\s\S]*?runGuestQuery/);
  assert.match(route, /endpoint === "guest-clear"[\s\S]*?deleteGuestSession[\s\S]*?clearGuestCookie/);
  assert.match(composer, /\/guest-workbook-sheets/);
  assert.match(composer, /\/guest-ask/);
  assert.doesNotMatch(composer, /\/tables|workspace dataset|Authenticated · workspace scoped/);
  assert.match(composer, /Upload a CSV or Excel file and enter a question to continue\./);
  assert.match(composer, /Enter a question about your data\./);
  assert.match(composer, /Upload a CSV or Excel file first\./);
  assert.doesNotMatch(composer, /disabled=\{busy \|\| !question\.trim\(\)\}/);
});
