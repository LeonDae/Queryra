import { createClient } from "./server.js";
import { resolveWorkspaceId, verifiedSubject } from "./auth-core.js";
import { HttpError } from "../http-error.js";

export async function getVerifiedUser() {
  let supabase;
  try { supabase = await createClient(); }
  catch { throw new HttpError(503, "Supabase Auth is not configured on this server.", "AUTH_CONFIGURATION"); }
  let userId;
  try { userId = await verifiedSubject(supabase); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "Supabase Auth could not verify the current session. Try again shortly.", "AUTH_UNAVAILABLE");
  }
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
  } catch {}
  return { supabase, userId, user };
}

export async function requireWorkspace() {
  const { supabase, userId } = await getVerifiedUser();
  const workspaceId = await resolveWorkspaceId(supabase);
  return { supabase, userId, workspaceId };
}

