import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import { parseOptions } from "../cli/args.js";
import { csvTableName, resolveCsvPath } from "../cli/csv-source.js";
import { removeGeminiKey, resolveGeminiKey, writeConfig } from "../cli/config.js";
import { runCsvAction } from "../cli/engine.js";
import { generateSql } from "../cli/gemini.js";
import { formatJsonResult, formatTable } from "../cli/presentation.js";
import { parseResultLimit, validateCliSelect } from "../cli/sql-safety.js";

const execFileAsync = promisify(execFile);
let directory;
let csvPath;

test.before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "queryra-cli-"));
  csvPath = path.join(directory, "regional_sales.csv");
  await writeFile(csvPath, "region,revenue,units\nNorth,100.5,2\nSouth,75,3\nNorth,50,1\n", "utf8");
});

test.after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("help describes MVP commands and selected local CSV source", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli/bin/queryra.js", "--help"]);
  assert.match(stdout, /queryra schema/);
  assert.match(stdout, /queryra ask/);
  assert.match(stdout, /local CSV only/i);
  const version = await execFileAsync(process.execPath, ["cli/bin/queryra.js", "--version"]);
  assert.equal(version.stdout.trim(), "0.1.0");
});

test("CLI options parse local paths, directory selection, result limits, JSON, and question arguments", () => {
  assert.deepEqual(parseOptions(["Show", "revenue", "--file", "data/sales.csv", "--limit", "15", "--json"]), {
    json: true, positional: ["Show", "revenue"], file: "data/sales.csv", limit: "15",
  });
  assert.deepEqual(parseOptions(["--dir", "a folder", "ask", "question"]), {
    json: false, positional: ["ask", "question"], dir: "a folder",
  });
  assert.throws(() => parseOptions(["--file"]), /requires a value/i);
  assert.throws(() => parseOptions(["--unknown"]), (error) => error.exitCode === 2 && /unknown option/i.test(error.message));
});

test("CSV paths are validated, resolved relative to cwd, and named dynamically", async () => {
  assert.equal(await resolveCsvPath("regional_sales.csv", directory), csvPath);
  assert.equal(csvTableName(csvPath), "regional_sales");
  await assert.rejects(resolveCsvPath("missing.csv", directory), /could not be found/i);
  await assert.rejects(resolveCsvPath("data.parquet", directory), /\.csv/);
  await assert.rejects(resolveCsvPath("", directory), /choose a CSV/i);
  const emptyCsv = path.join(directory, "empty.csv");
  await writeFile(emptyCsv, "", "utf8");
  await assert.rejects(resolveCsvPath(emptyCsv), /empty/i);
});

test("schema CLI command reports the selected file relation and discovered fields", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["cli/bin/queryra.js", "schema", "--file", csvPath]);
  assert.match(stdout, /Dataset: regional_sales\.csv/);
  assert.match(stdout, new RegExp(`Dataset directory: ${path.basename(directory).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(stdout, /Relation: public\.regional_sales/);
  assert.match(stdout, /revenue DOUBLE/i);
});

test("schema defaults to the invocation working directory", async () => {
  const invocationDirectory = path.join(directory, "cwd default");
  await mkdir(invocationDirectory);
  await writeFile(path.join(invocationDirectory, "cwd_sales.csv"), "region,sales\nEast,4\n", "utf8");
  const { stdout } = await execFileAsync(process.execPath, [path.resolve("cli/bin/queryra.js"), "schema"], { cwd: invocationDirectory });
  assert.match(stdout, /Dataset directory: current directory/);
  assert.match(stdout, /Dataset: cwd_sales\.csv/);
});

test("DuckDB discovers the real CSV columns and runs local aggregation", async () => {
  const schema = await runCsvAction({ action: "schema", filePath: csvPath });
  assert.match(schema.schema, /region VARCHAR/i);
  assert.match(schema.schema, /revenue DOUBLE/i);
  const query = await runCsvAction({ action: "query", filePath: csvPath, sql: "SELECT region, SUM(revenue) AS total FROM public.regional_sales GROUP BY region ORDER BY total DESC", limit: 10 });
  assert.deepEqual(query.rows, [{ region: "North", total: 150.5 }, { region: "South", total: 75 }]);
});

test("DuckDB query results obey row and output byte caps", async () => {
  const limited = await runCsvAction({ action: "query", filePath: csvPath, sql: "SELECT * FROM public.regional_sales", limit: 1 });
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.truncated, true);
  await assert.rejects(runCsvAction({ action: "query", filePath: csvPath, sql: "SELECT * FROM public.regional_sales", limit: 2, maxOutputBytes: 40 }), /2 MiB output limit/i);
});

test("CLI enforces its execution deadline and terminates a stuck worker", async () => {
  class StalledWorker extends EventEmitter {
    terminate() { this.terminated = true; }
  }
  let instance;
  await assert.rejects(runCsvAction({ action: "schema", filePath: csvPath, timeoutMs: 1, watchdogGraceMs: 5, WorkerClass: class extends StalledWorker { constructor(...args) { super(...args); instance = this; } } }), /execution limit/i);
  assert.equal(instance.terminated, true);
});

test("SQL safety accepts a single dataset SELECT and rejects writes, files, and other relations", () => {
  assert.equal(validateCliSelect("SELECT SUM(revenue) FROM public.regional_sales", "regional_sales"), "SELECT SUM(revenue) FROM public.regional_sales");
  assert.throws(() => validateCliSelect("SELECT 1; DROP TABLE public.regional_sales", "regional_sales"), /one SQL statement/i);
  assert.throws(() => validateCliSelect("WITH gone AS (DELETE FROM public.regional_sales RETURNING *) SELECT * FROM gone", "regional_sales"), /write or administrative/i);
  assert.throws(() => validateCliSelect("SELECT * FROM read_csv_auto('secret.csv')"), /not allowed|configured CSV dataset/i);
  assert.throws(() => validateCliSelect("SELECT pg_catalog.pg_sleep(2)"), /function .*not allowed/i);
  assert.throws(() => validateCliSelect("SELECT * FROM public.other_data", "regional_sales"), /configured CSV dataset/i);
});

test("result limits and table/JSON formatters are stable", () => {
  assert.equal(parseResultLimit("25"), 25);
  assert.throws(() => parseResultLimit("1001"), /from 1 to 1000/i);
  assert.match(formatTable([{ region: "North", revenue: 12 }]), /North/);
  const json = JSON.parse(formatJsonResult({ sql: "SELECT 1", rows: [{ value: 1 }], truncated: false, durationMs: 2, providerUsage: null }));
  assert.equal(json.rowCount, 1);
  assert.equal(json.providerUsage, null);
});

test("Gemini BYOK uses only the CLI key and returns actual usage metadata", async () => {
  let request;
  const statuses = [];
  const result = await generateSql("total revenue by region", "region VARCHAR\nrevenue DOUBLE", {
    environment: { QUERYRA_GEMINI_API_KEY: "test-cli-key", GOOGLE_API_KEY: "must-not-be-used" },
    tableName: "regional_sales",
    onStatus: (message) => statuses.push(message),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({
        candidates: [{ content: { parts: [{ text: "SELECT region, SUM(revenue) FROM public.regional_sales GROUP BY region" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
      }) };
    },
  });
  assert.equal(request.options.headers["x-goog-api-key"], "test-cli-key");
  assert.match(request.options.body, /public\.regional_sales/);
  assert.deepEqual(result.providerUsage, { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 });
  assert.deepEqual(statuses, ["SQL safety validation"]);
});

test("Gemini timeout and quota errors are concise and do not echo API keys", async () => {
  await assert.rejects(generateSql("q", "x VARCHAR", { environment: { QUERYRA_GEMINI_API_KEY: "never-print-this" }, fetchImpl: async () => { const error = new Error("never-print-this"); error.name = "TimeoutError"; throw error; } }), (error) => {
    assert.match(error.message, /timed out/i);
    assert.doesNotMatch(error.message, /never-print-this/);
    return true;
  });
  await assert.rejects(generateSql("q", "x VARCHAR", { environment: { QUERYRA_GEMINI_API_KEY: "never-print-this" }, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: "never-print-this" } }) }) }), /quota or rate limit/i);
  await assert.rejects(generateSql("q", "x VARCHAR", { environment: {}, config: {}, fetchImpl: async () => assert.fail("Gemini must not be called without a key") }), (error) => error.exitCode === 3);
});

test("Gemini reports unsupported and ambiguous requests without treating them as SQL", async () => {
  const options = {
    environment: { QUERYRA_GEMINI_API_KEY: "synthetic-test-key" },
    tableName: "regional_sales",
    columns: ["region", "customer", "amount"],
  };
  await assert.rejects(generateSql("sales by customer age", "region VARCHAR\ncustomer VARCHAR\namount DOUBLE", {
    ...options,
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "UNSUPPORTED: customer age" }] } }] }) }),
  }), (error) => {
    assert.equal(error.exitCode, 5);
    assert.match(error.message, /customer age/i);
    assert.match(error.message, /region.*customer.*amount/i);
    return true;
  });
  await assert.rejects(generateSql("show the best customer", "region VARCHAR\ncustomer VARCHAR\namount DOUBLE", {
    ...options,
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "CLARIFY: Which measure should define best?" }] } }] }) }),
  }), /please clarify.*which measure/i);
});

test("key environment override and config removal semantics do not fall back to website key", async () => {
  assert.equal(resolveGeminiKey({ geminiApiKey: "saved" }, { GOOGLE_API_KEY: "website-key" }), "saved");
  assert.equal(resolveGeminiKey({}, { GOOGLE_API_KEY: "website-key" }), "");
  assert.equal(resolveGeminiKey({ geminiApiKey: "saved" }, { QUERYRA_GEMINI_API_KEY: "override" }), "override");
});

test("user-local config saves and removes the CLI key without printing it", async () => {
  const prior = process.env.APPDATA;
  process.env.APPDATA = directory;
  try {
    await writeConfig({ geminiApiKey: "test-secret-only" });
    const { readConfig } = await import("../cli/config.js");
    assert.deepEqual(await readConfig(), { geminiApiKey: "test-secret-only" });
    const remaining = await removeGeminiKey(await readConfig());
    assert.deepEqual(remaining, {});
    assert.deepEqual(await readConfig(), {});
  } finally {
    if (prior === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prior;
  }
});
