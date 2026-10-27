import { access, constants, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CliError } from "./errors.js";

export const MAX_CSV_BYTES = 50 * 1024 * 1024;

export async function resolveCsvPath(value, cwd = process.cwd()) {
  if (!value || typeof value !== "string") throw new CliError("Choose a CSV file with --file or run `queryra init` to set a default.", 5);
  const filePath = path.resolve(cwd, value);
  if (path.extname(filePath).toLowerCase() !== ".csv") throw new CliError("The selected data source must be a .csv file.", 5);
  let info;
  try {
    await access(filePath);
    info = await stat(filePath);
  } catch {
    throw new CliError("The selected CSV file could not be found or opened.", 5);
  }
  if (!info.isFile()) throw new CliError("The selected CSV path must point to a file.", 5);
  if (info.size === 0) throw new CliError("The selected CSV file is empty and has no header row.", 5);
  if (info.size > MAX_CSV_BYTES) throw new CliError(`CSV files are limited to ${MAX_CSV_BYTES} bytes (50 MiB).`, 5);
  return filePath;
}

export function displayDatasetDirectory(directory, cwd = process.cwd()) {
  const absoluteDirectory = path.resolve(cwd, directory);
  const relativeDirectory = path.relative(cwd, absoluteDirectory);
  if (!relativeDirectory) return "current directory";
  if (path.isAbsolute(relativeDirectory)) return path.basename(absoluteDirectory) || "selected directory";
  return relativeDirectory;
}

export async function discoverCsvFiles(directory, { cwd = process.cwd(), readdirImpl = readdir, accessImpl = access, statImpl = stat } = {}) {
  if (!directory || typeof directory !== "string") throw new CliError("Choose a dataset directory with --dir or run `queryra init`.", 5);
  const resolvedDirectory = path.resolve(cwd, directory);
  let info;
  try {
    info = await statImpl(resolvedDirectory);
    if (!info.isDirectory()) throw new Error("not-directory");
    await accessImpl(resolvedDirectory, constants.R_OK);
  } catch {
    throw new CliError("The dataset directory does not exist or cannot be read. Use --dir or run `queryra init` with a readable folder.", 5);
  }

  let entries;
  try { entries = await readdirImpl(resolvedDirectory, { withFileTypes: true }); }
  catch {
    throw new CliError("The dataset directory cannot be read. Check its permissions or select another directory with --dir.", 5);
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".csv")
    .map((entry) => path.join(resolvedDirectory, entry.name));
  const readable = await Promise.all(candidates.map(async (filePath) => {
    try {
      const fileInfo = await statImpl(filePath);
      if (!fileInfo.isFile()) return null;
      await accessImpl(filePath, constants.R_OK);
      return filePath;
    } catch { return null; }
  }));
  return {
    directory: resolvedDirectory,
    files: readable.filter(Boolean).sort((left, right) => path.basename(left).localeCompare(path.basename(right), undefined, { sensitivity: "base" })),
  };
}

export function csvTableName(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return base && /^[a-z_]/.test(base) ? base : `dataset_${base || "data"}`;
}
