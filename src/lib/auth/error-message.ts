export type SafeAuthError = { message: string; detail?: string };

export function formatAuthError(reason: unknown): SafeAuthError {
  const error = reason && typeof reason === "object" ? reason as Record<string, unknown> : null;
  const message = typeof error?.message === "string"
    ? error.message
    : reason instanceof Error ? reason.message : "";
  const status = Number(error?.status) || 0;
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = /^[a-z0-9_-]{1,64}$/i.test(rawCode) ? rawCode : "";

  if (/database error saving new user/i.test(message)) {
    return { message: "Supabase could not create your account because profile setup failed. The database owner should check the auth.users to profiles trigger and migrations." };
  }
  if (status === 404) {
    return { message: "Supabase Auth endpoint was not found. Check NEXT_PUBLIC_SUPABASE_URL: use your project root URL and remove /rest/v1." };
  }
  if (/signups? (?:are )?not allowed|signup disabled|signups_disabled/i.test(`${message} ${code}`)) {
    return { message: "Supabase is not accepting new signups. Enable email signups in the Supabase Auth settings." };
  }
  if (status >= 500 || /failed to fetch|network(?:request| error)?|ERR_NAME_NOT_RESOLVED|fetch failed/i.test(message)) {
    return { message: "Can't reach the sign-in service. Check your connection and try again. If it continues, the store service may be unavailable." };
  }
  if (/invalid login credentials/i.test(message)) return { message: "Email or password is incorrect." };
  if (/user already registered/i.test(message)) return { message: "An account with this email already exists. Sign in instead." };
  if (/email not confirmed/i.test(message)) return { message: "This account is unconfirmed. The owner must confirm it in Supabase." };
  if (/email address not authorized/i.test(message)) return { message: "Supabase could not send email. Signup without SMTP requires Confirm email off; password recovery still needs email delivery." };
  if (/email address .* is invalid|email_address_invalid/i.test(message)) return { message: "Enter a valid email address." };
  if (status === 429 || /rate limit/i.test(message)) return { message: "Too many sign-in or recovery attempts. Wait before trying again." };
  if (/password should be/i.test(message)) return { message: "Choose a stronger password and try again." };
  if (status >= 400) {
    return {
      message: "Supabase rejected the request. Check the Supabase Auth settings and try again.",
      detail: code ? `HTTP ${status}; ${code}` : `HTTP ${status}`,
    };
  }
  return { message: "The sign-in service returned an unexpected error. Please try again or contact support." };
}
