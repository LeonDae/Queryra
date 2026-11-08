import { HttpError } from "./http-error.js";

const windows = new Map();
const inFlight = new Map();

function positiveInteger(value, fallback, maximum) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`Invalid resource limit: expected a positive integer no greater than ${maximum}.`);
  }
  return parsed;
}

export function consumeRateLimit(scope, environmentVariable, fallback, windowMs = 60_000, maximum = 10_000) {
  const limit = positiveInteger(process.env[environmentVariable], fallback, maximum);
  const now = Date.now();
  let window = windows.get(scope);
  if (!window || now >= window.resetAt) {
    if (windows.size >= 1_000) {
      for (const [key, activeWindow] of windows) {
        if (now >= activeWindow.resetAt) windows.delete(key);
      }
    }
    window = { count: 0, resetAt: now + windowMs };
    windows.set(scope, window);
  }
  if (window.count >= limit) {
    throw new HttpError(429, "This service has reached its request limit for the current window. Try again after it resets.", "LOCAL_RATE_LIMITED");
  }
  window.count += 1;
  return { limit, remaining: Math.max(0, limit - window.count), resetAt: window.resetAt };
}

export async function withConcurrencyLimit(scope, environmentVariable, fallback, operation, maximum = 20, overload = {}) {
  const limit = positiveInteger(process.env[environmentVariable], fallback, maximum);
  const active = inFlight.get(scope) || 0;
  if (active >= limit) {
    throw new HttpError(429, overload.message || "The model service is busy. Try again shortly.", overload.code || "PROVIDER_CAPACITY");
  }
  inFlight.set(scope, active + 1);
  try {
    return await operation();
  } finally {
    const current = inFlight.get(scope) || 1;
    if (current <= 1) inFlight.delete(scope);
    else inFlight.set(scope, current - 1);
  }
}
