"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./env.js";

let client;
export function createClient() {
  if (!client) {
    const { url, key } = getSupabasePublicConfig();
    client = createBrowserClient(url, key);
  }
  return client;
}
