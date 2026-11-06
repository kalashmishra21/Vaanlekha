"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import type { ZodIssue } from "zod";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { signInSchema, signUpSchema } from "@/lib/auth/validation";
import { useLocale } from "@/components/layout/locale-provider";

type Mode = "signin" | "signup" | "reset";
type Field = "fullName" | "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<Field, string>>;
const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function fieldErrors(issues: ZodIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0] as Field | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

function authMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "";
  const status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : 0;
  if (status >= 500 || /failed to fetch|network(?:request| error)?|ERR_NAME_NOT_RESOLVED|fetch failed/i.test(message)) {
    return "Can't reach the sign-in service. Check your connection and try again. If it continues, the store service may be unavailable.";
  }
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/user already registered/i.test(message)) return "An account with this email already exists. Sign in instead.";
  if (/email not confirmed/i.test(message)) return "This account is unconfirmed. The owner must confirm it in Supabase.";
  if (/email address not authorized/i.test(message)) return "Supabase could not send email. Signup without SMTP requires Confirm email off; password recovery still needs email delivery.";
  if (/email address .* is invalid|email_address_invalid/i.test(message)) return "Enter a valid email address.";
  if (status === 429 || /rate limit/i.test(message)) return "Too many sign-in or recovery attempts. Wait before trying again.";
  if (/password should be/i.test(message)) return "Choose a stronger password and try again.";
  return "We couldn't complete that request. Please try again.";
}

export function SignInForm({ initialMode = "signin", linkError = false }: { initialMode?: Mode; linkError?: boolean }) {
  const router = useRouter();
  const { t } = useLocale();
  const [mode, setMode] = useState<Mode>(initialMode);
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [visible, setVisible] = useState({ password: false, confirmPassword: false });

  function switchMode(next: Mode) {
    if (busy || next === mode) return;
    setMode(next);
    setNotice("");
    setError("");
    setErrors({});
    setVisible({ password: false, confirmPassword: false });
    router.replace(next === "signup" ? "/signin?mode=signup" : next === "reset" ? "/signin?mode=reset" : "/signin", { scroll: false });
  }

  function clearField(field: Field) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const values = {
      fullName: String(form.get("fullName") || ""),
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
      confirmPassword: String(form.get("confirmPassword") || ""),
    };
    if (mode === "reset") {
      const email = z.email().safeParse(values.email.trim());
      if (!email.success) { setErrors({ email: t("Enter a valid email address.") }); return; }
      const client = createSupabaseBrowserClient();
      if (!client) { setError(t("Password reset is unavailable.")); return; }
      setBusy(true);
      try {
        const { error: authError } = await client.auth.resetPasswordForEmail(email.data, { redirectTo: `${window.location.origin}/auth/callback?next=reset-password` });
        if (authError) throw authError;
        setNotice(t("Password reset needs email delivery from Supabase. Without SMTP, a reset email will not arrive."));
      } catch (reason) { setError(t(authMessage(reason))); }
      finally { setBusy(false); }
      return;
    }
    const parsed = mode === "signin" ? signInSchema.safeParse(values) : signUpSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(Object.entries(fieldErrors(parsed.error.issues)).map(([key, value]) => [key, value ? t(value) : value])) as FieldErrors);
      return;
    }
    setErrors({});
    const client = createSupabaseBrowserClient();
    if (!client) {
      setError(t("Sign in is unavailable because Supabase is not configured."));
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { data, error: authError } = await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (authError) throw authError;
        if (!data.user?.email_confirmed_at) {
          await client.auth.signOut();
          throw new Error("Email not confirmed");
        }
        router.replace("/app");
      } else {
        const signup = signUpSchema.parse(values);
        const { data, error: authError } = await client.auth.signUp({
          email: signup.email,
          password: signup.password,
          options: { data: { display_name: signup.fullName } },
        });
        if (authError) throw authError;
        if (!data.session || !data.user?.email_confirmed_at) {
          if (data.session) await client.auth.signOut();
          setError(t("Email confirmation is still enabled in Supabase. Turn it off under Authentication → Sign In / Providers → Email to allow signup without SMTP."));
          return;
        }
        router.replace("/app");
      }
    } catch (reason) {
      setError(t(authMessage(reason)));
    } finally {
      setBusy(false);
    }
  }

  function field(name: Field, label: string, input: ReactNode) {
    return <div className="auth-field" key={name}>
      <label htmlFor={`auth-${name}`}>{label}</label>
      {input}
      {errors[name] && <span className="auth-field-error" id={`auth-${name}-error`} role="alert">{errors[name]}</span>}
    </div>;
  }

  function passwordField(name: "password" | "confirmPassword", label: string) {
    const shown = visible[name];
    return field(name, label, <div className="auth-password-field">
      <input id={`auth-${name}`} name={name} type={shown ? "text" : "password"}
        autoComplete={name === "password" && mode === "signin" ? "current-password" : "new-password"}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `auth-${name}-error` : undefined}
        onInput={() => clearField(name)} />
      <button type="button" className="auth-visibility" aria-label={`${t(shown ? "Hide" : "Show")} ${t(label).toLowerCase()}`}
        aria-pressed={shown} onClick={() => setVisible((current) => ({ ...current, [name]: !shown }))}>
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>);
  }

  return <>
    <h2 id="auth-title">{t(mode === "signin" ? "Welcome back." : mode === "signup" ? "Create your account." : "Reset your password.")}</h2>
    <div className="auth-tabs" role="group" aria-label={t("Account action")}>
      <button type="button" aria-pressed={mode === "signin"} disabled={busy} onClick={() => switchMode("signin")}>{t("Sign in")}</button>
      <button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => switchMode("signup")}>{t("Create account")}</button>
    </div>
    <form key={mode} className="business-form auth-form" method="post" noValidate onSubmit={(event) => void submit(event)}>
      {mode === "signup" && field("fullName", t("Full name"), <input id="auth-fullName" name="fullName" type="text" autoComplete="name"
        aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? "auth-fullName-error" : undefined}
        onInput={() => clearField("fullName")} />)}
      {field("email", t("Email"), <input id="auth-email" name="email" type="email" autoComplete="email" inputMode="email"
        aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "auth-email-error" : undefined}
        onInput={() => clearField("email")} />)}
      {mode !== "reset" && passwordField("password", t("Password"))}
      {mode === "signup" && passwordField("confirmPassword", t("Confirm password"))}
      <button className="button button-copper" disabled={busy || !hydrated} type="submit">{t(busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link")}</button>
    </form>
    {mode === "signin" && <button className="auth-text-action" type="button" onClick={() => switchMode("reset")}>{t("Forgot password?")}</button>}
    {mode === "reset" && <button className="auth-text-action" type="button" onClick={() => switchMode("signin")}>{t("Back to sign in")}</button>}
    {linkError && <p className="form-error" role="alert">{t("This link is invalid or expired. Request a new password reset email.")}</p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="auth-footnote">{t("Your shop records are private to your account. Use a strong, unique password. Password recovery needs email delivery.")}</p>
  </>;
}
