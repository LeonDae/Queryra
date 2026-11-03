import { HttpError } from "./http-error.js";

function firstForwardedValue(value) {
  return value?.split(",", 1)[0]?.trim();
}

function expectedRequestOrigin(request) {
  let requestUrl;
  try { requestUrl = new URL(request.url); }
  catch { throw new HttpError(403, "Request origin could not be verified.", "CROSS_ORIGIN_REQUEST"); }

  // A reverse proxy may expose the browser-facing authority/protocol through
  // forwarded headers while request.url reflects its internal connection.
  // Only honor these headers when the front proxy is trusted to overwrite them.
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"))?.toLowerCase();
  const protocol = forwardedProto ? `${forwardedProto}:` : requestUrl.protocol;
  if (!["http:", "https:"].includes(protocol)) {
    throw new HttpError(403, "Request origin could not be verified.", "CROSS_ORIGIN_REQUEST");
  }

  try { return new URL(`${protocol}//${host}`).origin; }
  catch { throw new HttpError(403, "Request origin could not be verified.", "CROSS_ORIGIN_REQUEST"); }
}

export function assertSameOriginMutation(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new HttpError(403, "Cross-origin writes are not allowed.", "CROSS_ORIGIN_REQUEST");
  if (!origin) return;
  let requestOrigin;
  try {
    const originUrl = new URL(origin);
    if (origin === "null" || originUrl.pathname !== "/" || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) {
      throw new Error("Invalid Origin header.");
    }
    requestOrigin = originUrl.origin;
  }
  catch { throw new HttpError(403, "Request origin could not be verified.", "CROSS_ORIGIN_REQUEST"); }
  const expectedOrigin = expectedRequestOrigin(request);
  if (requestOrigin !== expectedOrigin) throw new HttpError(403, "Cross-origin writes are not allowed.", "CROSS_ORIGIN_REQUEST");
}
