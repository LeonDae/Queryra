import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "../../../lib/supabase/env.js";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") || "/workspace";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/workspace";
  if (!code) return NextResponse.redirect(new URL("/login?error=confirmation", url.origin));
  const store = await cookies();
  const { url: projectUrl, key } = getSupabasePublicConfig();
  const supabase = createServerClient(projectUrl, key, { cookies: { getAll: () => store.getAll(), setAll: (values) => values.forEach(({ name, value, options }) => store.set(name, value, options)) } });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/login?error=confirmation" : next, url.origin));
}
