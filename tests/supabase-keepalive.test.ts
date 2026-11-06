import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const from = vi.fn();
  const select = vi.fn();
  const limit = vi.fn();
  const abortSignal = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const upsert = vi.fn();
  const deleteRows = vi.fn();
  const storageFrom = vi.fn();
  const createClient = vi.fn(() => ({
    from,
    storage: { from: storageFrom },
  }));
  const getSupabaseConfig = vi.fn();
  return { from, select, limit, abortSignal, insert, update, upsert, deleteRows, storageFrom, createClient, getSupabaseConfig };
});

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: mocks.getSupabaseConfig }));

import { GET } from "@/app/api/cron/supabase-keepalive/route";

const cronSecret = "test-cron-secret-value-32-bytes";
const request = (authorization?: string) => new Request("https://vaanlekha.test/api/cron/supabase-keepalive", {
  headers: authorization ? { authorization } : undefined,
});

describe("Supabase daily keep-alive cron", () => {
  const originalSecret = process.env.CRON_SECRET;
  let queryResult: { error: unknown };
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.CRON_SECRET = cronSecret;
    queryResult = { error: null };
    mocks.getSupabaseConfig.mockReturnValue({ url: "https://example.supabase.co", key: "public-anon-test-key" });
    const queryBuilder = {
      select: mocks.select,
      limit: mocks.limit,
      abortSignal: mocks.abortSignal,
      insert: mocks.insert,
      update: mocks.update,
      upsert: mocks.upsert,
      delete: mocks.deleteRows,
    };
    mocks.from.mockReturnValue(queryBuilder);
    mocks.select.mockReturnValue(queryBuilder);
    mocks.limit.mockReturnValue(queryBuilder);
    mocks.abortSignal.mockImplementation(() => Promise.resolve(queryResult));
    mocks.createClient.mockReturnValue({ from: mocks.from, storage: { from: mocks.storageFrom } });
    for (const fn of [mocks.from, mocks.select, mocks.limit, mocks.abortSignal, mocks.insert, mocks.update, mocks.upsert, mocks.deleteRows, mocks.storageFrom, mocks.createClient]) fn.mockClear();
    log = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rejects missing and invalid bearer credentials before contacting Supabase", async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer incorrect-secret"))).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("uses one RLS-compatible, read-only HEAD query and returns no business data", async () => {
    const response = await GET(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-anon-test-key",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("shops");
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith("id", { head: true });
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(1);
    expect(mocks.abortSignal).toHaveBeenCalledOnce();
    expect(mocks.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteRows).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
  });

  it("fails safely when Supabase returns an error and logs no response details", async () => {
    mocks.abortSignal.mockResolvedValue({ error: { message: "private row contents and token" } });
    const response = await GET(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Database health check failed." });
    expect(log).toHaveBeenCalledWith("supabase_keepalive", expect.objectContaining({
      status: "failed",
      error: "database_request_failed",
      timestamp: expect.any(String),
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("private row contents");
  });

  it("aborts a request at the deadline and returns a sanitized timeout response", async () => {
    vi.useFakeTimers();
    mocks.abortSignal.mockImplementation(() => new Promise(() => {}));
    const pending = GET(request(`Bearer ${cronSecret}`));
    await vi.advanceTimersByTimeAsync(8_000);
    const response = await pending;

    expect(response.status).toBe(503);
    expect(mocks.abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(log).toHaveBeenCalledWith("supabase_keepalive", expect.objectContaining({ error: "database_request_timeout" }));
  });

  it("skips overlapping requests within the same function instance", async () => {
    let completeRequest!: (result: { error: null }) => void;
    mocks.abortSignal.mockImplementation(() => new Promise((resolve) => { completeRequest = resolve; }));
    const first = GET(request(`Bearer ${cronSecret}`));
    const second = await GET(request(`Bearer ${cronSecret}`));

    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ ok: true, skipped: true });
    expect(mocks.from).toHaveBeenCalledOnce();

    completeRequest({ error: null });
    expect((await first).status).toBe(200);
  });

  it("rejects an unset or too-short secret without making a database request", async () => {
    process.env.CRON_SECRET = "short";
    const response = await GET(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps exactly one daily UTC Vercel cron entry", async () => {
    const config = await import("../vercel.json");
    expect(config.default.crons).toEqual([
      { path: "/api/cron/supabase-keepalive", schedule: "0 9 * * *" },
    ]);
  });
});
