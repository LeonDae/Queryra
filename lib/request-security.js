import { HttpError } from "./http-error.js";

export function assertSameOriginMutation(request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new HttpError(403, "Cross-origin writes are not allowed.", "CROSS_ORIGIN_REQUEST");
  if (!origin) return;
  let requestOrigin;
  try { requestOrigin = new URL(request.url).origin; }
  catch { throw new HttpError(403, "Request origin could not be verified.", "CROSS_ORIGIN_REQUEST"); }
  if (origin === "null" || origin !== requestOrigin) throw new HttpError(403, "Cross-origin writes are not allowed.", "CROSS_ORIGIN_REQUEST");
}
