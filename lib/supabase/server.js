import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./env.js";

export async function createClient() {
  const { url, key } = getSupabasePublicConfig();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(values) {
        try { for (const { name, value, options } of values) cookieStore.set(name, value, options); }
        catch { /* Server Components cannot write cookies; proxy refreshes sessions. */ }
      },
    },
  });
}
