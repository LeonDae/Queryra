import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

function configDirectory() {
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, "Queryra")
    : path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "queryra");
}

function configFilePath() {
  return path.join(configDirectory(), "config.json");
}

function projectConfigFilePath(projectDirectory) {
  const absolute = path.resolve(projectDirectory);
  const identity = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const hash = createHash("sha256").update(identity).digest("hex");
  return path.join(configDirectory(), "projects", `${hash}.json`);
}

async function readJson(file, label) {
  try {
    const content = await readFile(file, "utf8");
    if (Buffer.byteLength(content) > 16_384) throw new Error("config-too-large");
    const value = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config-shape");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new CliError(`${label} is invalid. Run \`queryra init\` to repair it.`, 3);
  }
}

async function writeJson(file, value) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(directory, 0o700);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") await chmod(temporary, 0o600);
    await rename(temporary, file);
  } catch {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true }).catch(() => {});
    throw new CliError("Could not save Queryra's user-local configuration.", 3);
  }
}

export async function readConfig() {
  const config = await readJson(configFilePath(), "Queryra credential configuration");
  return typeof config?.geminiApiKey === "string" ? { geminiApiKey: config.geminiApiKey } : {};
}

export async function writeConfig(config, { dropLegacyDataset = false } = {}) {
  const existing = dropLegacyDataset ? null : await readJson(configFilePath(), "Queryra credential configuration");
  const normalized = {
    ...(typeof config?.geminiApiKey === "string" ? { geminiApiKey: config.geminiApiKey } : {}),
    ...(typeof existing?.defaultCsv === "string" ? { defaultCsv: existing.defaultCsv } : {}),
  };
  await writeJson(configFilePath(), normalized);
}

export async function readProjectSettings(projectDirectory = process.cwd()) {
  const file = projectConfigFilePath(projectDirectory);
  const settings = await readJson(file, "Queryra project dataset settings");
  if (settings) {
    return {
      ...(typeof settings.datasetDirectory === "string" ? { datasetDirectory: settings.datasetDirectory } : {}),
      ...(typeof settings.defaultCsv === "string" ? { defaultCsv: settings.defaultCsv } : {}),
    };
  }

  // Migrate the previous global defaultCsv into a separate per-project file.
  const legacyConfig = await readJson(configFilePath(), "Queryra credential configuration");
  if (typeof legacyConfig?.defaultCsv !== "string") return {};
  const legacyCsv = path.resolve(legacyConfig.defaultCsv);
  const migrated = { datasetDirectory: path.dirname(legacyCsv), defaultCsv: legacyCsv };
  await writeProjectSettings(projectDirectory, migrated);
  await writeConfig({ geminiApiKey: legacyConfig.geminiApiKey }, { dropLegacyDataset: true });
  return migrated;
}

export async function writeProjectSettings(projectDirectory, settings) {
  const file = projectConfigFilePath(projectDirectory);
  const normalized = {
    ...(typeof settings?.datasetDirectory === "string" ? { datasetDirectory: path.resolve(settings.datasetDirectory) } : {}),
    ...(typeof settings?.defaultCsv === "string" ? { defaultCsv: path.resolve(settings.defaultCsv) } : {}),
  };
  await writeJson(file, normalized);
  return normalized;
}

export function resolveGeminiKey(config, environment = process.env) {
  return environment.QUERYRA_GEMINI_API_KEY || config.geminiApiKey || "";
}

export async function removeGeminiKey(config) {
  const { geminiApiKey: _removed, ...remaining } = config;
  await writeConfig(remaining);
  return remaining;
}
