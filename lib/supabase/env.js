export function getSupabasePublicConfig(environment) {
  // Keep these direct references: Next.js replaces static NEXT_PUBLIC_* reads
  // in client bundles at build time. Dynamic process.env property access is not inlined.
  const url = environment
    ? environment.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = environment
    ? environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error();
  } catch { throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid HTTPS project URL."); }
  return { url, key };
}
