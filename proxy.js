import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./lib/supabase/env.js";

export async function proxy(request) {
  let config;
  try { config = getSupabasePublicConfig(); }
  catch { return NextResponse.next(); }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(values, headers) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        headers?.forEach?.((value, name) => response.headers.set(name, value));
      },
    },
  });
  try { await supabase.auth.getClaims(); }
  catch { /* Route/page guards verify claims and return sanitized auth errors. */ }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
