import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getClaims, getUser, createServerClient } = vi.hoisted(() => {
  const getClaims = vi.fn();
  const getUser = vi.fn();
  return { getClaims, getUser, createServerClient: vi.fn(() => ({ auth: { getClaims, getUser } })) };
});
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("../src/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({ url: "https://example.supabase.co", key: "public-test-key" }),
}));

import { proxy } from "../src/proxy";

describe("public route session proxy", () => {
  beforeEach(() => {
    createServerClient.mockClear();
    getClaims.mockReset();
    getUser.mockReset();
  });

  it("serves anonymous landing visitors without a Supabase auth lookup", async () => {
    const response = await proxy(new NextRequest("http://localhost:3100/"));
    expect(response.status).toBe(200);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("still checks and redirects a visitor with an auth cookie", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "owner-a" } } });
    getUser.mockResolvedValue({ data: { user: { id: "owner-a", email_confirmed_at: "2026-10-28T10:00:00Z", is_anonymous: false } } });
    const request = new NextRequest("http://localhost:3100/", {
      headers: { cookie: "sb-example-auth-token=synthetic-cookie" },
    });
    const response = await proxy(request);
    expect(createServerClient).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3100/app");
  });

  it("does not redirect an unverified session into the workspace", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "owner-a" } } });
    getUser.mockResolvedValue({ data: { user: { id: "owner-a", email_confirmed_at: null } } });
    const response = await proxy(new NextRequest("http://localhost:3100/signin", {
      headers: { cookie: "sb-example-auth-token=synthetic-cookie" },
    }));
    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalledOnce();
  });
});
