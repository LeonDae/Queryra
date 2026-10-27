#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { parseOptions } from "../args.js";
import { readConfig, removeGeminiKey, resolveGeminiKey, writeConfig } from "../config.js";
import { discoverCsvFiles } from "../csv-source.js";
import { selectCsvDataset } from "../datasets.js";
import { runAsk } from "../ask.js";
import { runCsvAction } from "../engine.js";
import { promptLine, promptSecret } from "../prompt.js";
import { formatJsonResult, formatTable } from "../presentation.js";
import { CLI_DEFAULT_RESULT_LIMIT, parseResultLimit } from "../sql-safety.js";
import { CliError } from "../errors.js";
import { writeError, writeHeader, writeStatus, writeSuccess, writeWarning } from "../terminal.js";
import path from "node:path";

const HELP = `Queryra CLI - natural language to SQL for local CSV files

Usage:
  queryra --help
  queryra --version
  queryra init
  queryra config --check|--replace-key|--remove-key
  queryra schema [--dir <directory> | --file <path.csv>]
  queryra ask ["<question>"] [--dir <directory> | --file <path.csv>] [--limit <1-1000>] [--json]

Environment:
  QUERYRA_GEMINI_API_KEY   Optional override for the key saved in user config
  QUERYRA_GEMINI_MODEL     Optional Gemini model (default: models/gemini-2.5-flash)

Default dataset directory: the current working directory for every command.
Data sources: local CSV only. Queryra never connects to PostgreSQL or a hosted database.`;

async function init() {
  writeHeader();
  writeStatus("Setup");
  const config = await readConfig();
  const envKey = process.env.QUERYRA_GEMINI_API_KEY;
  let savedKey = config.geminiApiKey || "";
  let replaceKey = false;
  if (envKey) writeSuccess("Gemini API key is available from QUERYRA_GEMINI_API_KEY; it overrides the saved key.");
  else if (!savedKey) {
    const entered = process.stdin.isTTY
    ? await promptSecret("Queryra CLI Gemini API key (hidden; press Enter to skip): ")
      : "";
    if (entered) { savedKey = entered; replaceKey = true; }
  } else if (process.stdin.isTTY) {
    const answer = await promptLine("A Queryra CLI Gemini API key is already configured. Replace it? [y/N]: ");
    if (/^y(es)?$/i.test(answer)) {
      const entered = await promptSecret("Queryra CLI new Gemini API key (hidden): ");
      if (entered) { savedKey = entered; replaceKey = true; }
    }
  }
  if (replaceKey) await writeConfig({ geminiApiKey: savedKey });
  const keyConfigured = Boolean(envKey || savedKey);
  if (keyConfigured) writeSuccess("Gemini API key is configured. init does not call Gemini; run an ask command to test it.");
  else writeWarning("Gemini API key was skipped. Run `queryra config --replace-key` or set QUERYRA_GEMINI_API_KEY before using `queryra ask`.");

  const currentDirectory = process.cwd();
  writeStatus("Checking CSV datasets in the current directory");
  const discovered = await discoverCsvFiles(currentDirectory);
  if (!discovered.files.length) {
    writeWarning("No CSV datasets found in the current directory. Add a CSV here, move into its folder with cd, or use --dir \".\\datasets\". Queryra CLI does not scan subfolders.");
  } else {
    writeSuccess(`Found ${discovered.files.length} readable CSV dataset${discovered.files.length === 1 ? "" : "s"} in the current directory.`);
    for (const file of discovered.files) writeStatus(path.basename(file));
    if (discovered.files.length > 1) writeStatus("Run a data command to choose a dataset, or use --file for scripts.");
  }
}

async function configCommand(args) {
  const [operation] = args;
  const config = await readConfig();
  writeHeader();
  if (operation === "--check") {
    const keyConfigured = Boolean(resolveGeminiKey(config));
    (keyConfigured ? writeSuccess : writeWarning)(`Gemini API key: ${keyConfigured ? "configured" : "missing"}`);
    writeStatus("Dataset directory: current directory");
    try {
      const { files } = await discoverCsvFiles(process.cwd());
      writeStatus(`Readable CSV datasets: ${files.length}`);
      for (const file of files) writeStatus(path.basename(file));
    } catch (error) { writeWarning(error.message); }
    writeStatus("Dataset preferences saved by older CLI versions are ignored; commands use the current directory.");
    if (!keyConfigured) process.exitCode = 3;
    return;
  }
  if (operation === "--replace-key") {
    writeStatus("Credential setup");
    const key = await promptSecret("Queryra CLI Gemini API key (hidden): ");
    if (!key) throw new CliError("No key entered; saved configuration was unchanged.", 3);
    await writeConfig({ ...config, geminiApiKey: key });
    writeSuccess("Gemini API key replaced in user-local config.");
    return;
  }
  if (operation === "--remove-key") {
    await removeGeminiKey(config);
    writeSuccess("Saved Gemini API key removed. QUERYRA_GEMINI_API_KEY still overrides config if set in the environment.");
    return;
  }
  throw new CliError("Use `queryra config --check`, `--replace-key`, or `--remove-key`.", 2);
}

async function main(argv) {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") { console.log(HELP); return; }
  if (command === "--version" || command === "-v") { console.log("0.1.0"); return; }
  if (command === "init") return init();
  if (command === "config") return configCommand(args);
  const options = parseOptions(args);
  if (command === "schema") {
    if (options.positional.length) throw new CliError("Usage: queryra schema [--dir <directory> | --file <path.csv>]", 2);
    writeHeader();
    writeStatus("Dataset discovery");
    const selected = await selectCsvDataset({ file: options.file, directory: options.dir, command: "schema" });
    writeStatus("Schema discovery");
    const result = await runCsvAction({ action: "schema", filePath: selected.filePath });
    writeSuccess("Schema ready");
    console.log(`Relation: public.${result.tableName}\n\n${result.schema}`);
    return;
  }
  if (command !== "ask") throw new CliError(`Unknown command: ${command}\n\n${HELP}`, 2);
  const statusOutput = options.json ? process.stderr : process.stdout;
  writeHeader(statusOutput);
  const question = (options.positional.join(" ").trim() || (process.stdin.isTTY ? await promptLine("Ask your question: ", { output: statusOutput }) : "")).trim();
  if (!question) throw new CliError("Provide a natural-language question in quotes.", 2);
  const limit = parseResultLimit(options.limit ?? CLI_DEFAULT_RESULT_LIMIT);
  const started = performance.now();
  writeStatus("Dataset discovery", statusOutput);
  const selected = await selectCsvDataset({ file: options.file, directory: options.dir, command: "ask", output: statusOutput });
  writeStatus("Schema discovery", statusOutput);
  const result = await runAsk({
    question,
    filePath: selected.filePath,
    limit,
    onStatus: (message) => writeStatus(message, statusOutput),
  });
  const payload = { ...result, rowCount: result.rows.length, durationMs: Math.round(performance.now() - started) };
  writeSuccess("Query completed", options.json ? process.stderr : process.stdout);
  if (options.json) { console.log(formatJsonResult(payload)); return; }
  console.log(`Generated SQL:\n${result.sql}\n`);
  console.log(formatTable(result.rows));
  console.log(`\n${result.rows.length} row(s)${result.truncated ? ` (limited to ${limit})` : ""} | ${payload.durationMs} ms`);
}

main(process.argv.slice(2)).catch((error) => {
  writeError(error instanceof Error ? error.message : "The command failed.");
  process.exitCode = error?.exitCode || 1;
});
