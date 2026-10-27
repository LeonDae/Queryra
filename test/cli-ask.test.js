import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { runAsk } from "../cli/ask.js";
import { runCsvAction } from "../cli/engine.js";
import { generateSql } from "../cli/gemini.js";
import { assertQuestionDimensions } from "../cli/question-guard.js";

let directory;
let filePath;
const execFileAsync = promisify(execFile);

test.before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "queryra-cli-ask-"));
  filePath = path.join(directory, "orders.csv");
  await writeFile(filePath, "region,customer,amount\nEast,Ada,10.5\nEast,Lin,20.0\nWest,Ada,30\nWest,Maya,40\n", "utf8");
});

test.after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

function mockedGemini(sql) {
  return (question, schema, options) => generateSql(question, schema, {
    ...options,
    environment: { QUERYRA_GEMINI_API_KEY: "synthetic-test-key" },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: sql }] } }] }),
    }),
  });
}

test("average order amount by region succeeds against the selected CSV", async () => {
  const result = await runAsk({
    question: "Show the average order amount by region",
    filePath,
    generate: async (_question, schema, options) => {
      assert.match(schema, /amount DOUBLE/i);
      assert.deepEqual(options.columns, ["region", "customer", "amount"]);
      return mockedGemini("SELECT region, AVG(amount) AS average_order_amount FROM public.orders GROUP BY region ORDER BY average_order_amount DESC")(_question, schema, options);
    },
  });
  assert.deepEqual(result.rows, [
    { region: "West", average_order_amount: 35 },
    { region: "East", average_order_amount: 15.25 },
  ]);
});

test("total sales by customer succeeds and preserves the aggregate alias", async () => {
  const result = await runAsk({
    question: "Show total sales by customer",
    filePath,
    generate: mockedGemini("SELECT customer, SUM(amount) AS total_sales FROM public.orders GROUP BY customer ORDER BY total_sales DESC, customer ASC"),
  });
  assert.deepEqual(result.rows, [
    { customer: "Ada", total_sales: 40.5 },
    { customer: "Maya", total_sales: 40 },
    { customer: "Lin", total_sales: 20 },
  ]);
});

test("customer age requests stop before Gemini can substitute an unrelated query", async () => {
  let providerCalled = false;
  await assert.rejects(runAsk({
    question: "Show total sales by customer age",
    filePath,
    generate: async () => { providerCalled = true; return { sql: "SELECT customer, SUM(amount) FROM public.orders GROUP BY customer" }; },
  }), (error) => {
    assert.equal(error.exitCode, 5);
    assert.match(error.message, /customer age/i);
    assert.match(error.message, /region.*customer.*amount/i);
    return true;
  });
  assert.equal(providerCalled, false);
});

test("the CLI reports customer age as missing and emits no SQL or result rows", async () => {
  let failure;
  try {
    await execFileAsync(process.execPath, [
      path.resolve("cli/bin/queryra.js"),
      "ask", "Show total sales by customer age", "--file", filePath,
    ], {
      cwd: directory,
      env: { ...process.env, APPDATA: path.join(directory, "appdata"), QUERYRA_GEMINI_API_KEY: "" },
    });
    assert.fail("expected unsupported question to stop");
  } catch (error) {
    failure = error;
  }
  assert.equal(failure.code, 5);
  assert.match(failure.stderr, /customer age/i);
  assert.match(failure.stderr, /available columns:.*region.*customer.*amount/i);
  assert.doesNotMatch(failure.stdout, /Generated SQL|Query completed/);
});

test("CLI ask completes SQL generation and DuckDB execution without a live Gemini request", async () => {
  const preloadPath = path.join(directory, "mock-gemini.mjs");
  await writeFile(preloadPath, `globalThis.fetch = async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "SELECT region, SUM(amount) AS total_sales FROM public.orders GROUP BY region ORDER BY total_sales DESC" }] } }] }) });\n`, "utf8");
  const { stdout } = await execFileAsync(process.execPath, [
    "--import", pathToFileURL(preloadPath).href,
    path.resolve("cli/bin/queryra.js"),
    "ask", "Show total sales by region", "--file", filePath,
  ], {
    cwd: directory,
    env: { ...process.env, APPDATA: path.join(directory, "appdata"), QUERYRA_GEMINI_API_KEY: "synthetic-test-key" },
  });
  assert.match(stdout, /Generated SQL:\s*SELECT region, SUM\(amount\) AS total_sales/i);
  assert.match(stdout, /East\s+\|\s+30\.5/i);
  assert.match(stdout, /West\s+\|\s+70/i);
});

test("dimension guard does not reject an ordinary descriptive phrase when its field exists", () => {
  assert.doesNotThrow(() => assertQuestionDimensions(
    "Show total sales by product category",
    "category VARCHAR\namount DOUBLE",
    ["category", "amount"],
  ));
});

test("unknown generated SQL columns are rejected by DuckDB binding before query execution", async () => {
  await assert.rejects(runCsvAction({
    action: "query",
    filePath,
    sql: "SELECT customer_age, SUM(amount) AS total_sales FROM public.orders GROUP BY customer_age",
    limit: 10,
  }), (error) => {
    assert.equal(error.exitCode, 5);
    assert.match(error.message, /customer_age/i);
    assert.match(error.message, /available columns:.*region.*customer.*amount/i);
    return true;
  });
});

test("temporary Gemini failures return no query result and never trigger execution", async () => {
  const actions = [];
  await assert.rejects(runAsk({
    question: "Show total sales by customer",
    filePath,
    runAction: async (request) => {
      actions.push(request.action);
      if (request.action === "schema") return runCsvAction(request);
      assert.fail("query execution must not follow a provider failure");
    },
    generate: (question, schema, options) => generateSql(question, schema, {
      ...options,
      environment: { QUERYRA_GEMINI_API_KEY: "synthetic-test-key" },
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: { message: "temporary failure" } }) }),
    }),
  }), (error) => {
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /temporarily unavailable/i);
    return true;
  });
  assert.deepEqual(actions, ["schema"]);
});
