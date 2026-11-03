import { redirect } from "next/navigation";
import { getVerifiedUser } from "../../lib/supabase/auth.js";
import SchemaStudioClient from "../schema-studio-client.jsx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Schema Studio — Queryra",
  description: "Define, validate, and deploy relational schemas for your Queryra workspace.",
};

export default async function SchemaStudioPage() {
  let user = null;
  try {
    const verified = await getVerifiedUser();
    user = verified.user;
  } catch {
    redirect("/login?next=%2Fschema-studio");
  }

  const firstName =
    user?.user_metadata?.first_name ||
    user?.user_metadata?.full_name?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "Developer";

  return <SchemaStudioClient initialUser={{ ...user, firstName }} />;
}
