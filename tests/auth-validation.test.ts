import { describe, expect, it, vi } from "vitest";
import { signInSchema, signUpSchema } from "../src/lib/auth/validation";
import { profileUpdateSchema } from "../src/lib/auth/profile-schema";
import { formatAuthError } from "../src/lib/auth/error-message";
import { getSupabaseConfig, normalizeSupabaseProjectUrl } from "../src/lib/supabase/config";

describe("auth form validation", () => {
  it("normalizes email and full name before account creation", () => {
    const result = signUpSchema.parse({ fullName: "  Demo Owner  ", email: "  OWNER@EXAMPLE.COM ", password: "demo-password", confirmPassword: "demo-password" });
    expect(result.fullName).toBe("Demo Owner");
    expect(result.email).toBe("owner@example.com");
  });

  it("rejects mismatched passwords at the confirmation field", () => {
    const result = signUpSchema.safeParse({ fullName: "Demo Owner", email: "owner@example.com", password: "demo-password", confirmPassword: "different-password" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["confirmPassword"]);
  });

  it("requires a 12-character password for new accounts", () => {
    expect(signUpSchema.safeParse({ fullName: "Shop Owner", email: "owner@example.com", password: "short-pass", confirmPassword: "short-pass" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "Shop Owner", email: "owner@example.com", password: "LongPass123!", confirmPassword: "LongPass123!" }).success).toBe(true);
  });

  it("requires only email and password for sign in", () => {
    expect(signInSchema.safeParse({ email: "owner@example.com", password: "demo-password" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "owner@example.com", password: "" }).success).toBe(false);
  });
});

describe("profile edit boundary", () => {
  it("accepts trimmed account and shop names within their limits", () => {
    expect(profileUpdateSchema.parse({ field: "displayName", value: "  Demo Owner  " }).value).toBe("Demo Owner");
    expect(profileUpdateSchema.parse({ field: "shopName", value: "  Corner Store  " }).value).toBe("Corner Store");
  });

  it("rejects blank, control-character and oversized edits", () => {
    expect(profileUpdateSchema.safeParse({ field: "displayName", value: " " }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ field: "shopName", value: "Shop\nInjection" }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ field: "displayName", value: "a".repeat(81) }).success).toBe(false);
  });
});

describe("Supabase project URL configuration", () => {
  it("removes a copied PostgREST path before creating Supabase clients", () => {
    expect(normalizeSupabaseProjectUrl("https://project.supabase.co/rest/v1")).toBe("https://project.supabase.co");
    expect(normalizeSupabaseProjectUrl("https://project.supabase.co/rest/v1/")).toBe("https://project.supabase.co");
    expect(normalizeSupabaseProjectUrl("https://project.supabase.co/")).toBe("https://project.supabase.co");
  });

  it("returns the project root when the environment contains the REST endpoint", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co/rest/v1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
    try {
      expect(getSupabaseConfig()).toEqual({ url: "https://project.supabase.co", key: "public-test-key" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("safe Supabase Auth errors", () => {
  it("explains a missing Auth route without exposing the submitted form", () => {
    const error = formatAuthError(Object.assign(new Error("Not Found"), { status: 404 }));
    expect(error.message).toContain("project root URL");
    expect(error.message).toContain("remove /rest/v1");
    expect(error.message).not.toContain("password");
  });

  it("points database user-creation failures to the profile trigger", () => {
    expect(formatAuthError(Object.assign(new Error("Database error saving new user"), { status: 500 })).message)
      .toContain("profile setup failed");
  });

  it("shows only a safe status and code for unrecognized Auth errors", () => {
    expect(formatAuthError(Object.assign(new Error("private message with personal data"), {
      status: 422, code: "signup_blocked",
    }))).toEqual({
      message: "Supabase rejected the request. Check the Supabase Auth settings and try again.",
      detail: "HTTP 422; signup_blocked",
    });
  });
});
