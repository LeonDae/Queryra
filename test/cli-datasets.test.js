import test from "node:test";
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverCsvFiles, displayDatasetDirectory } from "../cli/csv-source.js";
import { readConfig, readProjectSettings } from "../cli/config.js";
import { selectCsvDataset } from "../cli/datasets.js";
import { nextMenuIndex, selectMenu } from "../cli/selector.js";
import { colorEnabled, paint, writeError, writeHeader, writeStatus } from "../cli/terminal.js";
import { promptSecret } from "../cli/prompt.js";

let root;
let project;
let csvA;
let csvB;
const execFileAsync = promisify(execFile);

test.before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "queryra-cli-datasets-"));
  project = path.join(root, "project with spaces");
  await mkdir(project);
  csvA = path.join(project, "sales 2026.csv");
  csvB = path.join(project, "returns.csv");
  await writeFile(csvA, "region,revenue\nNorth,20\n", "utf8");
  await writeFile(csvB, "region,count\nNorth,1\n", "utf8");
  await mkdir(path.join(project, "nested"));
  await writeFile(path.join(project, "nested", "ignored.csv"), "value\n1\n", "utf8");
  await writeFile(path.join(project, "notes.txt"), "not a dataset", "utf8");
});

test.after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test("CSV discovery returns immediate readable CSV files only and supports paths with spaces", async () => {
  const found = await discoverCsvFiles(project);
  assert.equal(found.directory, project);
  assert.deepEqual(found.files, [csvB, csvA].sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { sensitivity: "base" })));
  assert.deepEqual((await discoverCsvFiles(path.join(root, "empty"), {
    statImpl: async (candidate) => candidate === path.join(root, "empty") ? { isDirectory: () => true } : { isFile: () => false },
    accessImpl: async () => {},
    readdirImpl: async () => [],
  })).files, []);
});

test("CSV discovery skips inaccessible files and reports inaccessible directories", async () => {
  const found = await discoverCsvFiles(project, {
    accessImpl: async (candidate, mode) => {
      assert.equal(mode, constants.R_OK);
      if (candidate === csvA) throw new Error("permission denied");
    },
  });
  assert.deepEqual(found.files, [csvB]);
  await assert.rejects(discoverCsvFiles(project, { readdirImpl: async () => { throw new Error("denied"); } }), /cannot be read/i);
});

test("current directory is the default; --file overrides --dir and --dir overrides cwd", async () => {
  const output = { write() {} };
  const cwdDirectory = path.join(root, "current directory");
  await mkdir(cwdDirectory);
  const cwdCsv = path.join(cwdDirectory, "current.csv");
  await writeFile(cwdCsv, "value\n3\n", "utf8");
  const oldSettings = { datasetDirectory: project, defaultCsv: csvB };
  assert.equal((await selectCsvDataset({ cwd: cwdDirectory, projectSettings: oldSettings, output })).filePath, cwdCsv);
  assert.equal((await selectCsvDataset({ directory: project, cwd: cwdDirectory, output, interactive: true, choose: async (items) => items[0].value })).selectedBy, "interactive");
  assert.equal((await selectCsvDataset({ file: csvA, directory: cwdDirectory, cwd: root, output })).filePath, csvA);
  const picked = await selectCsvDataset({ directory: project, cwd: root, output, interactive: true, choose: async (items) => items.find((item) => item.value === csvA).value });
  assert.equal(picked.filePath, csvA);
  assert.equal(picked.selectedBy, "interactive");
  const single = path.join(root, "one");
  await mkdir(single);
  await writeFile(path.join(single, "only.csv"), "x\n1\n", "utf8");
  const auto = await selectCsvDataset({ directory: single, cwd: root, output });
  assert.equal(path.basename(auto.filePath), "only.csv");
});

test("multiple CSVs require a fresh choice without a configured default", async () => {
  const output = { write() {} };
  await assert.rejects(selectCsvDataset({ directory: project, cwd: root, output }), /found 2 CSV datasets/i);
  let menuOptions;
  const selected = await selectCsvDataset({ directory: project, cwd: root, output, interactive: true, choose: async (items, options) => { menuOptions = options; return items[0].value; } });
  assert.equal(selected.selectedBy, "interactive");
  assert.equal(menuOptions.title, "Choose a dataset");
  assert.equal(menuOptions.output, output);
});

test("dataset discovery gives a clear no-CSV error", async () => {
  const empty = path.join(root, "no csv");
  await mkdir(empty);
  await assert.rejects(selectCsvDataset({ directory: empty, cwd: root }), /no csv datasets found in/i);
});

test("init reports no datasets and skipped-key guidance without a provider call", async () => {
  const empty = path.join(root, "empty init folder");
  const appData = path.join(root, "init appdata");
  await mkdir(empty);
  const { stdout } = await execFileAsync(process.execPath, [path.resolve("cli/bin/queryra.js"), "init"], {
    cwd: empty,
    env: { ...process.env, APPDATA: appData, QUERYRA_GEMINI_API_KEY: "" },
  });
  assert.match(stdout, /no CSV datasets found in/i);
  assert.match(stdout, /does not scan subfolders/i);
  assert.match(stdout, /Gemini API key was skipped/i);
  assert.doesNotMatch(stdout, /Gemini request|googleapis\.com/i);
});

test("init validates and saves a single CSV under a Windows-style absolute path containing spaces", async () => {
  const datasetDirectory = path.join(root, "C Users", "Desktop", "Testing", "datasets with spaces");
  const appData = path.join(root, "single-csv appdata");
  await mkdir(datasetDirectory, { recursive: true });
  await writeFile(path.join(datasetDirectory, "smoke sales.csv"), "region,sales\nEast,10\n", "utf8");
  const { stdout } = await execFileAsync(process.execPath, [path.resolve("cli/bin/queryra.js"), "init"], {
    cwd: datasetDirectory,
    env: { ...process.env, APPDATA: appData, QUERYRA_GEMINI_API_KEY: "synthetic-test-key" },
  });
  assert.match(stdout, /Found 1 readable CSV dataset in/i);
  assert.match(stdout, /smoke sales\.csv/);
  assert.doesNotMatch(stdout, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(stdout, /Dataset directory saved for this project/);
  assert.doesNotMatch(stdout, /resolveCsvPath is not defined/);
});

test("schema with no explicit path uses cwd and ignores old project and legacy saved defaults", async () => {
  const empty = path.join(root, "empty current cwd");
  const appData = path.join(root, "legacy prefs appdata");
  await mkdir(empty);
  await mkdir(path.join(appData, "Queryra", "projects"), { recursive: true });
  await writeFile(path.join(appData, "Queryra", "config.json"), JSON.stringify({ geminiApiKey: "synthetic-test-key", defaultCsv: csvA }));
  const { createHash } = await import("node:crypto");
  const directoryIdentity = process.platform === "win32" ? empty.toLowerCase() : empty;
  const cwdHash = createHash("sha256").update(path.resolve(directoryIdentity)).digest("hex");
  await writeFile(path.join(appData, "Queryra", "projects", `${cwdHash}.json`), JSON.stringify({ datasetDirectory: project, defaultCsv: csvA }));
  const result = await new Promise((resolve) => {
    const child = execFile(process.execPath, [path.resolve("cli/bin/queryra.js"), "schema"], {
      cwd: empty,
      env: { ...process.env, APPDATA: appData },
    }, (error, stdout, stderr) => resolve({ code: error?.code, stdout, stderr }));
    child.on("error", () => resolve({ code: -1, stdout: "", stderr: "spawn failed" }));
  });
  assert.equal(result.code, 5);
  assert.match(result.stderr, new RegExp(empty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stderr, /move to the directory containing your CSV files/i);
  assert.doesNotMatch(result.stdout, /sales 2026\.csv/);
});

test("keyboard menu wraps selection and rejects non-interactive use", async () => {
  assert.equal(nextMenuIndex(0, -1, 3), 2);
  assert.equal(nextMenuIndex(2, 1, 3), 0);
  await assert.rejects(selectMenu([{ label: "a", value: "a" }], {
    input: { isTTY: false }, output: { isTTY: false },
  }), /interactive terminal/i);

  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (mode) => { input.isRaw = mode; };
  input.resume = () => {};
  input.pause = () => {};
  const output = { isTTY: true, write() {} };
  const pending = selectMenu([{ label: "first", value: 1 }, { label: "second", value: 2 }], { input, output });
  input.emit("keypress", "", { name: "down" });
  input.emit("keypress", "\r", { name: "return" });
  assert.equal(await pending, 2);
  assert.equal(input.isRaw, false);
});

test("hidden Gemini key prompt never echoes entered key material", async () => {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (mode) => { input.isRaw = mode; };
  input.resume = () => {};
  input.pause = () => {};
  const writes = [];
  const output = { write: (value) => writes.push(String(value)) };
  const pending = promptSecret("Enter key: ", { input, output });
  input.emit("data", Buffer.from("synthetic-secret"));
  input.emit("data", Buffer.from("\r"));
  assert.equal(await pending, "synthetic-secret");
  assert.equal(writes.join(""), "Enter key: \n");
  assert.equal(input.isRaw, false);
});

test("legacy global CSV preference migrates without mixing it into credential reads", async () => {
  const prior = process.env.APPDATA;
  const appData = path.join(root, "appdata");
  process.env.APPDATA = appData;
  try {
    await mkdir(path.join(appData, "Queryra"), { recursive: true });
    await writeFile(path.join(appData, "Queryra", "config.json"), JSON.stringify({ geminiApiKey: "test-only-key", defaultCsv: csvA }));
    const credentials = await readConfig();
    assert.deepEqual(credentials, { geminiApiKey: "test-only-key" });
    const migratedProject = path.join(root, "legacy project");
    await mkdir(migratedProject);
    const migrated = await readProjectSettings(migratedProject);
    assert.deepEqual(migrated, { datasetDirectory: project, defaultCsv: csvA });
    assert.deepEqual(await readConfig(), { geminiApiKey: "test-only-key" });
  } finally {
    if (prior === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prior;
  }
});

test("terminal styling respects NO_COLOR and plain output fallback", () => {
  const tty = { isTTY: true };
  assert.equal(colorEnabled(tty, { NO_COLOR: "" }), false);
  assert.equal(colorEnabled(tty, { FORCE_COLOR: "0" }), false);
  assert.equal(colorEnabled({ isTTY: false }, {}), false);
  assert.equal(colorEnabled(tty, { TERM: "dumb" }, "linux"), false);
  assert.equal(colorEnabled(tty, {}, "win32"), false);
  assert.equal(colorEnabled(tty, { WT_SESSION: "terminal" }, "win32"), true);
  assert.equal(paint("queryra", "cyan", { output: tty, environment: { NO_COLOR: "" } }), "queryra");
  const writes = [];
  const output = { isTTY: false, write: (value) => writes.push(String(value)) };
  writeHeader(output);
  writeStatus("Setup", output);
  writeError("A safe error", output);
  assert.match(writes.join(""), /Queryra CLI/);
  assert.match(writes.join(""), /\[i\] Queryra CLI Setup/);
  assert.match(writes.join(""), /\[x\] Queryra CLI A safe error/);
});

test("normal directory labels omit absolute home components", () => {
  const projectDirectory = path.join(root, "developer home", "sales project");
  assert.equal(displayDatasetDirectory(projectDirectory, projectDirectory), "current directory");
  assert.equal(displayDatasetDirectory(path.join(projectDirectory, "datasets"), projectDirectory), "datasets");
});

test("CLI package metadata declares its executable, runtime, and pinned DuckDB dependency", async () => {
  const metadata = JSON.parse(await readFile(path.resolve("cli/package.json"), "utf8"));
  const lockfile = JSON.parse(await readFile(path.resolve("cli/package-lock.json"), "utf8"));
  assert.equal(metadata.name, "queryra-cli");
  assert.equal(metadata.version, "0.1.0");
  assert.equal(lockfile.name, metadata.name);
  assert.equal(metadata.bin.queryra, "./bin/queryra.js");
  assert.match(metadata.description, /Queryra CLI.*CSV.*Gemini.*DuckDB/i);
  assert.equal(metadata.repository.url, "https://github.com/LeonDae/Queryra.git");
  assert.equal(metadata.repository.directory, "cli");
  assert.equal(metadata.homepage, "https://github.com/LeonDae/Queryra/tree/main/cli#readme");
  assert.equal(metadata.bugs.url, "https://github.com/LeonDae/Queryra/issues");
  assert.equal(metadata.license, "MIT");
  assert.ok(metadata.files.includes("LICENSE.md"));
  assert.equal(Object.hasOwn(metadata, "author"), false);
  assert.match(metadata.engines.node, />=20\.9/);
  assert.ok(metadata.dependencies["@duckdb/node-api"]);
  assert.ok(metadata.dependencies["pgsql-ast-parser"]);
  for (const target of ["win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"]) {
    assert.ok(lockfile.packages[`node_modules/@duckdb/node-bindings-${target}`], `missing DuckDB native package for ${target}`);
  }
  assert.match(await readFile(path.resolve("cli/bin/queryra.js"), "utf8"), /^#!\/usr\/bin\/env node/);
});
