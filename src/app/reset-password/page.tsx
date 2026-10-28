"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== form.get("confirmPassword")) { setError("Passwords do not match."); return; }
    const client = createSupabaseBrowserClient();
    if (!client) { setError("Password reset is unavailable."); return; }
    setBusy(true);
    try {
      const { data, error: accountError } = await client.auth.getUser();
      if (accountError || !data.user) throw new Error("Your reset link is invalid or expired. Request a new one.");
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      await client.auth.signOut();
      setMessage("Password updated. Sign in with your new password.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Password could not be updated.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-panel auth-reset-panel" aria-labelledby="reset-title">
    <p className="workspace-eyebrow">SECURE ACCOUNT ACCESS</p><h1 id="reset-title">Choose a new password.</h1>
    <form className="business-form auth-form" onSubmit={(event) => void save(event)}>
      <div className="auth-field"><label htmlFor="reset-password">New password</label><input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={8} /></div>
      <div className="auth-field"><label htmlFor="reset-confirm">Confirm password</label><input id="reset-confirm" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} /></div>
      <button className="button button-copper" type="submit" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
    </form>
    {message && <p role="status" className="form-notice">{message}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <Link href="/signin">Back to sign in</Link>
  </section></main>;
}
