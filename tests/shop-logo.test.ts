import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SHOP_LOGO_MAX_BYTES, validateShopLogoFile } from "../src/lib/business/shop-logo";

const testMocks = vi.hoisted(() => ({ getShopContext: vi.fn(), upload: vi.fn(), signedUrl: vi.fn() }));
vi.mock("@/server/data/context", () => ({ getShopContext: testMocks.getShopContext }));

const mediaMigration = readFileSync("supabase/migrations/20261028200000_merchant_profile_media.sql", "utf8");
const logoScopeMigration = readFileSync("supabase/migrations/20261028203000_shop_logo_policy_scope.sql", "utf8");
const phoneMigration = readFileSync("supabase/migrations/20261106190000_indian_mobile_phone_validation.sql", "utf8");
const shopId = "11111111-1111-4111-8111-111111111111";
const otherShopId = "22222222-2222-4222-8222-222222222222";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const imageBytes: Record<string, Uint8Array> = {
  "image/jpeg": Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]),
  "image/png": Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  "image/webp": Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
};

function uploadRequest(type: string, bytes = imageBytes[type]) {
  const form = new FormData();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  form.set("image", new File([body], "shop-image", { type }));
  return new Request("https://vaanlekha.example/api/profile/logo", {
    method: "POST", headers: { origin: "https://vaanlekha.example" }, body: form,
  });
}

function makeClient(shop: { logo_path: string | null } = { logo_path: null }, saveError = false) {
  const filters: Array<[string, string]> = [];
  const updates: unknown[] = [];
  const from = vi.fn((table: string) => {
    if (table !== "shops") throw new Error("unexpected table");
    const savedRow = { id: shopId };
    return {
      select: vi.fn(() => ({ eq: vi.fn((column: string, value: string) => {
        filters.push([column, value]);
        return { eq: vi.fn((nextColumn: string, nextValue: string) => {
          filters.push([nextColumn, nextValue]);
          return { single: async () => ({ data: shop, error: null }) };
        }) };
      }) })),
      update: vi.fn((values: unknown) => {
        updates.push(values);
        return { eq: vi.fn((column: string, value: string) => {
        filters.push([column, value]);
        return { eq: vi.fn((nextColumn: string, nextValue: string) => {
          filters.push([nextColumn, nextValue]);
          return { select: vi.fn(() => ({ maybeSingle: async () => saveError
            ? { data: null, error: { message: "metadata save failed" } } : { data: savedRow, error: null } })) };
        }) };
      }) };
      }),
    };
  });
  return {
    from,
    filters,
    updates,
    storage: { from: vi.fn(() => ({
      upload: testMocks.upload,
      createSignedUrl: testMocks.signedUrl,
    })) },
  };
}

describe("private shop image upload", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    testMocks.getShopContext.mockReset();
    testMocks.upload.mockReset().mockResolvedValue({ data: { path: `${shopId}/logo` }, error: null });
    testMocks.signedUrl.mockReset().mockResolvedValue({ data: { signedUrl: "https://storage.example/signed/logo" }, error: null });
    client = makeClient();
    testMocks.getShopContext.mockResolvedValue({ kind: "ready", client, userId, shop: { id: shopId, name: "Test shop" } });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(Object.entries(imageBytes))("accepts %s and saves to the signed-in owner's private shop path", async (type, bytes) => {
    const { POST } = await import("../src/app/api/profile/logo/route");
    const response = await POST(uploadRequest(type, bytes));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, logoUrl: "https://storage.example/signed/logo" });
    expect(testMocks.upload).toHaveBeenCalledWith(`${shopId}/logo`, bytes, expect.objectContaining({ contentType: type, upsert: true }));
    expect(client.filters).toContainEqual(["id", shopId]);
    expect(client.filters).toContainEqual(["owner_id", userId]);
    expect(client.updates).toContainEqual({ logo_path: `${shopId}/logo` });
    expect(response.headers.get("Cache-Control")).toContain("private");
  });

  it("rejects an invalid signature, a disallowed type, and files above 2 MB before writing", async () => {
    const { POST } = await import("../src/app/api/profile/logo/route");
    const mismatched = await POST(uploadRequest("image/png", imageBytes["image/jpeg"]));
    expect(mismatched.status).toBe(422);
    const unsupported = await POST(uploadRequest("image/gif", imageBytes["image/png"]));
    expect(unsupported.status).toBe(422);
    expect(validateShopLogoFile({ type: "image/png", size: SHOP_LOGO_MAX_BYTES + 1 })).toContain("up to 2 MB");
    expect(validateShopLogoFile({ type: "image/png", size: SHOP_LOGO_MAX_BYTES })).toBeNull();
    expect(testMocks.upload).not.toHaveBeenCalled();
  });

  it("retries an uploaded but not yet linked object with an idempotent upsert", async () => {
    const failedSave = makeClient({ logo_path: null }, true);
    const retry = makeClient({ logo_path: null });
    testMocks.getShopContext
      .mockResolvedValueOnce({ kind: "ready", client: failedSave, userId, shop: { id: shopId, name: "Test shop" } })
      .mockResolvedValueOnce({ kind: "ready", client: retry, userId, shop: { id: shopId, name: "Test shop" } });
    const { POST } = await import("../src/app/api/profile/logo/route");
    expect((await POST(uploadRequest("image/png"))).status).toBe(503);
    expect((await POST(uploadRequest("image/png"))).status).toBe(200);
    expect(testMocks.upload).toHaveBeenCalledTimes(2);
    expect(testMocks.upload.mock.calls.every((call) => call[2].upsert === true)).toBe(true);
  });

  it("does not log provider error messages or private upload data", async () => {
    testMocks.upload.mockResolvedValueOnce({ error: { statusCode: "403", message: "private owner details" } });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { POST } = await import("../src/app/api/profile/logo/route");
    expect((await POST(uploadRequest("image/png"))).status).toBe(503);
    expect(warning).toHaveBeenCalledWith("Shop image upload failed", { statusCode: "403" });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private owner details");
  });

  it("does not report success when the private preview URL could not be issued", async () => {
    testMocks.signedUrl.mockResolvedValueOnce({ data: null, error: { statusCode: "403", message: "private storage error" } });
    const { POST } = await import("../src/app/api/profile/logo/route");
    const response = await POST(uploadRequest("image/png"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "The image was saved, but its private preview could not be loaded. Please retry." });
  });

  it("does not upload for signed-out users or cross-origin requests", async () => {
    const { POST } = await import("../src/app/api/profile/logo/route");
    testMocks.getShopContext.mockResolvedValueOnce({ kind: "signed-out" });
    expect((await POST(uploadRequest("image/png"))).status).toBe(401);
    const request = uploadRequest("image/png");
    const crossOrigin = new Request(request, { headers: { origin: "https://attacker.example" } });
    expect((await POST(crossOrigin)).status).toBe(403);
    expect(testMocks.upload).not.toHaveBeenCalled();
  });
});

describe("shop logo and phone database migrations", () => {
  it("keeps logo storage private, enforces owner-only object access, and validates phones in PostgreSQL", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create schema storage;
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create function storage.foldername(name text) returns text[] language sql immutable as $$
          select array[split_part(name, '/', 1)]
        $$;
        create table public.shops(id uuid primary key, owner_id uuid not null, name text not null);
        create table public.customers(id uuid primary key, phone text);
        create table public.suppliers(id uuid primary key, phone text);
        create table storage.buckets(id text primary key, name text not null, public boolean not null,
          file_size_limit bigint, allowed_mime_types text[]);
        create table storage.objects(bucket_id text not null, name text not null, metadata jsonb default '{}'::jsonb,
          primary key(bucket_id, name));
        alter table storage.objects enable row level security;
        insert into public.shops(id, owner_id, name) values
          ('${shopId}', '${userId}', 'My shop'), ('${otherShopId}', '${otherUserId}', 'Other shop');
      `);
      await db.exec(mediaMigration);
      await db.exec(logoScopeMigration);
      await db.exec(phoneMigration);
      const bucket = await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
        "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'shop-logos'");
      expect(bucket.rows[0]).toEqual({ public: false, file_size_limit: 2097152, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] });

      await db.exec(`
        grant usage on schema public, auth, storage to authenticated;
        grant select on public.shops to authenticated;
        grant select, insert, update on storage.objects to authenticated;
        grant execute on function auth.uid() to authenticated;
        set role authenticated;
        set request.jwt.claim.sub = '${userId}';
      `);
      await db.query(`insert into storage.objects(bucket_id, name) values ('shop-logos', '${shopId}/logo')`);
      await expect(db.query(`insert into storage.objects(bucket_id, name) values ('shop-logos', '${otherShopId}/logo')`)).rejects.toThrow();
      const visible = await db.query<{ count: number }>("select count(*)::int count from storage.objects where bucket_id = 'shop-logos'");
      expect(visible.rows[0].count).toBe(1);
      await db.query(`update storage.objects set metadata = '{"updated":true}'::jsonb where name = '${shopId}/logo'`);

      await db.exec("reset role;");
      await db.query(`insert into public.customers(id, phone) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '9876543210')`);
      await db.query(`insert into public.suppliers(id, phone) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', null)`);
      await db.query(`update public.shops set phone = '8765432109' where id = '${shopId}'`);
      await expect(db.query(`update public.shops set phone = '+91 8765432109' where id = '${shopId}'`)).rejects.toThrow();
      await expect(db.query(`insert into public.customers(id, phone) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '1234567890')`)).rejects.toThrow();
      await expect(db.query(`insert into public.suppliers(id, phone) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '87654321')`)).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 20_000);
});
