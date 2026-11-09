import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "../../../lib/supabase/env.js";
import { resolveSiteOrigin, safeRedirectPath } from "../../../lib/supabase/redirects.js";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requested = url.searchParams.get("next") || "/workspace";
  const next = safeRedirectPath(requested);
  const origin = resolveSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL, url.origin);
  if (!code) return NextResponse.redirect(new URL("/login?error=confirmation", origin));
  const store = await cookies();
  const { url: projectUrl, key } = getSupabasePublicConfig();
  const supabase = createServerClient(projectUrl, key, { cookies: { getAll: () => store.getAll(), setAll: (values) => values.forEach(({ name, value, options }) => store.set(name, value, options)) } });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/login?error=confirmation" : next, origin));
}
