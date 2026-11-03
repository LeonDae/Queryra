import { HttpError } from "../http-error.js";

export async function verifiedSubject(supabase) {
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    if (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500) throw new HttpError(503, "Supabase Auth could not verify the current session. Try again shortly.", "AUTH_UNAVAILABLE");
    throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  }
  if (typeof data?.claims?.sub !== "string" || !data.claims.sub) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  return data.claims.sub;
}

export async function resolveWorkspaceId(supabase) {
  let { data, error } = await supabase.from("workspace_members").select("workspace_id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error && error.code === "PGRST116") data = null;
  if (error && !["PGRST116"].includes(error.code)) throw new HttpError(503, "Workspace authorization is not available. Apply the reviewed workspace migration and verify Supabase API access.", "WORKSPACE_CONFIGURATION");
  if (!data?.workspace_id) {
    const created = await supabase.rpc("create_workspace", { workspace_name: "My Workspace" });
    if (created.error || !created.data) throw new HttpError(503, "Workspace setup is not ready. Apply the reviewed workspace migration before using data features.", "WORKSPACE_CONFIGURATION");
    return created.data;
  }
  return data.workspace_id;
}
