import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "../src/lib/auth/validation";
import { profileUpdateSchema } from "../src/lib/auth/profile-schema";

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
