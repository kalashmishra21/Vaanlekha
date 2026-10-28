import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "./lib/supabase/config";

export async function proxy(request: NextRequest) {
  const publicEntry = request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/signin";
  // Anonymous public pages need no session refresh. Avoid a Supabase auth
  // lookup on every landing request while still checking returning users.
  if (publicEntry && !request.cookies.getAll().some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"))) {
    return NextResponse.next({ request });
  }
  const config = getSupabaseConfig();
  if (!config) return NextResponse.next({ request });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  try {
    const { data } = await supabase.auth.getClaims();
    const verified = data?.claims?.sub && publicEntry ? await supabase.auth.getUser() : null;
    if (verified?.data.user?.email_confirmed_at && !verified.data.user.is_anonymous) {
      const redirect = NextResponse.redirect(new URL("/app", request.url));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
  } catch {
    // The destination route shows an unavailable state instead of hiding it.
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/", "/signin", "/app/:path*", "/api/business", "/api/assistant/:path*", "/api/voice/transcribe"],
};
