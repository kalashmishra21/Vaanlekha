import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const tokenType = request.nextUrl.searchParams.get("type");
  const destination = request.nextUrl.searchParams.get("next") === "reset-password" ? "/reset-password" : "/app";
  const config = getSupabaseConfig();
  if ((code || (tokenHash && ["signup", "recovery", "email_change", "email"].includes(tokenType || ""))) && config) {
    const response = NextResponse.redirect(new URL(destination, request.url));
    const client = createServerClient(config.url, config.key, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(items) {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { error } = code
      ? await client.auth.exchangeCodeForSession(code)
      : await client.auth.verifyOtp({ token_hash: tokenHash!, type: tokenType as "signup" | "recovery" | "email_change" | "email" });
    if (!error) return response;
  }
  return NextResponse.redirect(new URL("/signin?error=link", request.url));
}
