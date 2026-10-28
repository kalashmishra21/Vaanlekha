"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import type { ZodIssue } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { signInSchema, signUpSchema } from "@/lib/auth/validation";

type Mode = "signin" | "signup";
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
  if (/email not confirmed/i.test(message)) return "Please confirm your email before signing in.";
  if (/password should be/i.test(message)) return "Choose a stronger password and try again.";
  return "We couldn't complete that request. Please try again.";
}

export function SignInForm({ initialMode = "signin" }: { initialMode?: Mode }) {
  const router = useRouter();
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
    router.replace(next === "signup" ? "/signin?mode=signup" : "/signin", { scroll: false });
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
    const parsed = mode === "signin" ? signInSchema.safeParse(values) : signUpSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    const client = createSupabaseBrowserClient();
    if (!client) {
      setError("Sign in is unavailable because Supabase is not configured.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: authError } = await client.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (authError) throw authError;
        router.replace("/app");
        router.refresh();
      } else {
        const signup = signUpSchema.parse(values);
        const { data, error: authError } = await client.auth.signUp({
          email: signup.email,
          password: signup.password,
          options: { data: { display_name: signup.fullName }, emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (authError) throw authError;
        if (data.session) { router.replace("/app"); router.refresh(); }
        else setNotice("Check your email for a confirmation link, then return to sign in.");
      }
    } catch (reason) {
      setError(authMessage(reason));
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
      <button type="button" className="auth-visibility" aria-label={`${shown ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-pressed={shown} onClick={() => setVisible((current) => ({ ...current, [name]: !shown }))}>
        {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>);
  }

  return <>
    <h2 id="auth-title">{mode === "signin" ? "Welcome back." : "Create your account."}</h2>
    <div className="auth-tabs" role="group" aria-label="Account action">
      <button type="button" aria-pressed={mode === "signin"} disabled={busy} onClick={() => switchMode("signin")}>Sign in</button>
      <button type="button" aria-pressed={mode === "signup"} disabled={busy} onClick={() => switchMode("signup")}>Create account</button>
    </div>
    <form key={mode} className="business-form auth-form" method="post" noValidate onSubmit={(event) => void submit(event)}>
      {mode === "signup" && field("fullName", "Full name", <input id="auth-fullName" name="fullName" type="text" autoComplete="name"
        aria-invalid={Boolean(errors.fullName)} aria-describedby={errors.fullName ? "auth-fullName-error" : undefined}
        onInput={() => clearField("fullName")} />)}
      {field("email", "Email", <input id="auth-email" name="email" type="email" autoComplete="email" inputMode="email"
        aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "auth-email-error" : undefined}
        onInput={() => clearField("email")} />)}
      {passwordField("password", "Password")}
      {mode === "signup" && passwordField("confirmPassword", "Confirm password")}
      <button className="button button-copper" disabled={busy || !hydrated} type="submit">{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</button>
    </form>
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <p className="auth-footnote">Your shop records are private to your account. Email confirmation may be required by your Supabase project.</p>
  </>;
}
