"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "../lib/supabase/client.js";

export default function AuthForm({ mode }) {
  const router = useRouter();
  const search = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(search.get("error") === "confirmation" ? "That confirmation link is missing or expired. Request a new one or sign in." : "");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const signup = mode === "signup";

  async function submit(event) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      const supabase = createClient();
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") || "").trim();
      const password = String(form.get("password") || "");
      const confirmation = String(form.get("confirmPassword") || "");
      if (!/^\S+@\S+\.\S+$/.test(email) || password.length < (signup ? 8 : 1) || password.length > 256) {
        setError(signup ? "Enter a valid email and a password of at least 8 characters." : "Enter a valid email and password."); return;
      }
      if (signup && password !== confirmation) { setError("Your passwords do not match. Check both fields and try again."); return; }
      const result = signup
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=%2Fworkspace` } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (signup && !result.data.session) { setMessage("Check your email to confirm your account, then return here to sign in."); return; }
      const next = search.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/workspace"); router.refresh();
    } catch (cause) {
      const detail = cause?.message || "";
      if (detail.includes("NEXT_PUBLIC_SUPABASE_URL") || detail.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) setError(detail);
      else if (cause?.status === 429) setError("Too many authentication attempts. Wait a moment and try again.");
      else setError("Authentication failed. Check your credentials, email confirmation, and Supabase Auth configuration.");
    }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><Link className="auth-back" href="/">← Back to Queryra</Link><div className="auth-orb auth-orb-one" /><div className="auth-orb auth-orb-two" /><section className="auth-card"><Link href="/" className="auth-brand"><Image src="/queryra-logo-dark.svg" width={42} height={42} alt="" priority /><span>queryra<span>.</span></span></Link><div className="auth-eyebrow">YOUR DATA, YOUR WORKSPACE</div><h1>{signup ? "Create your account" : "Welcome back."}</h1><p className="auth-intro">{signup ? "Create an account to access your Queryra workspace." : "Sign in to continue to your Queryra workspace."}</p><form className="auth-form" onSubmit={submit}><label>Email<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label><label>Password<span className="auth-password-field"><input name="password" type={passwordVisible ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 8 : undefined} maxLength={256} placeholder="Enter your password" required /><button className="auth-password-toggle" type="button" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible}>{passwordVisible ? "Hide" : "Show"}</button></span></label>{signup && <label>Confirm password<input name="confirmPassword" type={passwordVisible ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={256} placeholder="Re-enter your password" required /></label>}<button className="auth-submit" disabled={busy}>{busy ? <><span className="auth-spinner" />Please wait…</> : signup ? "Create account" : "Sign in to your workspace"}<span aria-hidden="true">→</span></button></form>{error && <p role="alert" className="auth-alert">{error}</p>}{message && <p role="status" className="auth-message">{message}</p>}<p className="auth-switch">{signup ? "Already registered? " : "New to Queryra? "}<Link href={signup ? "/login" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link></p><div className="auth-footnote"><span>⌑</span> Sign-in is powered by Supabase Auth.</div></section><footer className="auth-footer">© 2026 Queryra <Link href="/docs">CLI documentation</Link><span>MIT License</span></footer></main>;
}
