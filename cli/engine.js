import { Worker } from "node:worker_threads";
import { csvTableName, resolveCsvPath } from "./csv-source.js";
import { CliError } from "./errors.js";

export const DEFAULT_QUERY_TIMEOUT_MS = 15_000;
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export async function runCsvAction({ action, filePath, sql, limit = 100, timeoutMs = DEFAULT_QUERY_TIMEOUT_MS, maxOutputBytes = MAX_OUTPUT_BYTES, WorkerClass = Worker, watchdogGraceMs = 5_000 }) {
  const resolvedFile = await resolveCsvPath(filePath);
  const tableName = csvTableName(resolvedFile);
  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(new URL("./duckdb-worker.js", import.meta.url), {
      workerData: { action, filePath: resolvedFile, tableName, sql, limit, timeoutMs, maxOutputBytes },
      resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 },
    });
    let finished = false;
    let workerMessage;
    const timer = setTimeout(() => {
      finished = true;
      void worker.terminate();
      reject(new CliError(`CSV processing exceeded the ${timeoutMs} ms execution limit.`, 5));
    }, timeoutMs + watchdogGraceMs);
    worker.once("message", (message) => {
      if (finished) return;
      workerMessage = message;
    });
    worker.once("error", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new CliError("The local CSV query worker failed. Check the CSV and available memory.", 5));
    });
    worker.once("exit", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (workerMessage?.ok) resolve(workerMessage);
      else if (workerMessage) reject(new CliError(workerMessage.error, 5));
      else if (code === 0) reject(new CliError("The local CSV query worker returned no result.", 5));
      else reject(new CliError("The local CSV query worker exited unexpectedly.", 5));
    });
  });
}
