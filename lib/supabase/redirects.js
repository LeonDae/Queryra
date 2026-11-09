const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveSiteOrigin(siteUrl, requestOrigin) {
  const configuredOrigin = typeof siteUrl === "string" ? siteUrl.trim() : "";
  let parsed;
  try {
    parsed = new URL(configuredOrigin || requestOrigin);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a valid URL.");
  }

  const isLocalHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !isLocalHttp) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTPS except for local development.");
  }

  return parsed.origin;
}

export function getAuthCallbackUrl(siteUrl, requestOrigin) {
  const callback = new URL("/auth/callback", resolveSiteOrigin(siteUrl, requestOrigin));
  callback.searchParams.set("next", "/workspace");
  return callback.toString();
}

export function safeRedirectPath(value, fallback = "/workspace") {
  if (typeof value !== "string" || !value.startsWith("/")) return fallback;

  try {
    const base = "https://queryra.invalid";
    const target = new URL(value, base);
    if (target.origin !== base) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
