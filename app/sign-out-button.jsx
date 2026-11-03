"use client";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client.js";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login"); router.refresh();
  }
  return (
    <button
      onClick={signOut}
      className="rounded-lg border border-slate-200/90 hover:border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors shadow-sm"
    >
      Sign out
    </button>
  );
}
