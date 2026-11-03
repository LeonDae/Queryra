import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpError } from "./http-error.js";

export const GUEST_SESSION_COOKIE = "queryra_guest";
export const GUEST_SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_ROOT = path.join(os.tmpdir(), "queryra-guest-sessions");
const SECRET_KEY = Symbol.for("queryra.guest-session-secret");
const CLEANUP_KEY = Symbol.for("queryra.guest-session-cleanup-timer");

if (!globalThis[SECRET_KEY]) globalThis[SECRET_KEY] = randomBytes(32);
if (!globalThis[CLEANUP_KEY]) {
  const timer = setInterval(() => { void cleanupExpiredGuestSessions().catch(() => {}); }, 5 * 60 * 1000);
  timer.unref?.();
  globalThis[CLEANUP_KEY] = timer;
}

function sessionPath(id, filename = "") {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpError(401, "This guest session has expired. Select your file again.", "GUEST_SESSION_EXPIRED");
  return path.join(SESSION_ROOT, id, filename);
}

function sign(id) {
  return createHmac("sha256", globalThis[SECRET_KEY]).update(id).digest("base64url");
}

function tokenSessionId(token) {
  if (typeof token !== "string") return null;
  const [id, signature, ...extra] = token.split(".");
  if (extra.length || !/^[a-f0-9]{64}$/.test(id || "") || !signature) return null;
  const expected = Buffer.from(sign(id));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
}

export function readGuestToken(request) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== GUEST_SESSION_COOKIE) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); }
    catch { return null; }
  }
  return null;
}

export async function cleanupExpiredGuestSessions(now = Date.now()) {
  await mkdir(SESSION_ROOT, { recursive: true });
  const entries = await readdir(SESSION_ROOT, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).map(async (entry) => {
    const directory = path.join(SESSION_ROOT, entry.name);
    try {
      const info = await stat(directory);
      if (now - info.mtimeMs > GUEST_SESSION_TTL_MS) await rm(directory, { recursive: true, force: true });
    } catch { /* A concurrent request may already have removed the expired directory. */ }
  }));
}

export async function getGuestSession(request, { create = false, now = Date.now() } = {}) {
  await cleanupExpiredGuestSessions(now);
  const token = readGuestToken(request);
  const id = tokenSessionId(token);
  if (id) {
    try {
      const info = await stat(sessionPath(id));
      if (now - info.mtimeMs <= GUEST_SESSION_TTL_MS) {
        await utimes(sessionPath(id), now / 1000, now / 1000);
        return { id, token, isNew: false };
      }
      await rm(sessionPath(id), { recursive: true, force: true });
    } catch { /* Invalid or expired sessions are treated as new guests. */ }
  }
  if (!create) throw new HttpError(401, "Your temporary session has expired. Select your file again.", "GUEST_SESSION_EXPIRED");
  const newId = randomBytes(32).toString("hex");
  await mkdir(sessionPath(newId), { recursive: true, mode: 0o700 });
  return { id: newId, token: `${newId}.${sign(newId)}`, isNew: true };
}

export async function saveGuestDataset(id, content, metadata) {
  const directory = sessionPath(id);
  const nextFile = sessionPath(id, "dataset.next");
  await writeFile(nextFile, content, { mode: 0o600 });
  await rename(nextFile, sessionPath(id, "dataset.csv"));
  const metadataFile = sessionPath(id, "dataset.json");
  const nextMetadata = sessionPath(id, "dataset.json.next");
  await writeFile(nextMetadata, JSON.stringify(metadata), { mode: 0o600 });
  await rename(nextMetadata, metadataFile);
  const now = new Date();
  await utimes(directory, now, now);
}

export async function deleteGuestSession(id) {
  await rm(sessionPath(id), { recursive: true, force: true });
}

export async function loadGuestDataset(id) {
  try {
    const [csv, metadata] = await Promise.all([
      readFile(sessionPath(id, "dataset.csv")),
      readFile(sessionPath(id, "dataset.json"), "utf8"),
    ]);
    const now = new Date();
    await utimes(sessionPath(id), now, now);
    return { csvPath: sessionPath(id, "dataset.csv"), csv, metadata: JSON.parse(metadata) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Select a CSV or Excel workbook before asking a question.", "GUEST_DATASET_REQUIRED");
  }
}

export function setGuestCookie(response, session, { secure = process.env.NODE_ENV === "production" } = {}) {
  response.cookies.set(GUEST_SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/SQG/content/v1",
    maxAge: Math.floor(GUEST_SESSION_TTL_MS / 1000),
  });
  return response;
}

export function clearGuestCookie(response, { secure = process.env.NODE_ENV === "production" } = {}) {
  response.cookies.set(GUEST_SESSION_COOKIE, "", { httpOnly: true, secure, sameSite: "lax", path: "/SQG/content/v1", maxAge: 0 });
  return response;
}
