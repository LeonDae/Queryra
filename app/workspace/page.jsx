import { redirect } from "next/navigation";
import { getVerifiedUser } from "../../lib/supabase/auth.js";
import QueryraApp from "../queryra-app.jsx";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  try {
    await getVerifiedUser();
  } catch {
    redirect("/login?next=%2Fworkspace");
  }
  return <QueryraApp />;
}
