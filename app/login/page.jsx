import { Suspense } from "react";
import { redirect } from "next/navigation";
import AuthForm from "../auth-form.jsx";
import { getVerifiedUser } from "../../lib/supabase/auth.js";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in | Queryra", description: "Sign in to your Queryra workspace." };
export default async function LoginPage() {
  try { await getVerifiedUser(); redirect("/workspace"); } catch (error) { if (error?.digest?.startsWith("NEXT_REDIRECT")) throw error; }
  return <Suspense><AuthForm mode="login" /></Suspense>;
}
