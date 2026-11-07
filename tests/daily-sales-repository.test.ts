import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { SupabaseBusinessRepository } from "../src/server/data/tool-repository";

describe("daily sales data boundary", () => {
  it("requests an exact database aggregate for the complete Asia/Kolkata business day", async () => {
    const rpc = vi.fn(async () => ({ data: { total: "310.00", count: 2 }, error: null }));
    const client = { rpc };
    const shopId = "11111111-1111-4111-8111-111111111111";
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", shop: { id: shopId, name: "Test shop" },
    } as never);

    await expect(repository.dailySales("2026-10-07")).resolves.toEqual({ total: 310, count: 2 });
    expect(rpc).toHaveBeenCalledWith("get_shop_sales_summary", {
      p_shop_id: shopId, p_start: "2026-10-06T18:30:00.000Z", p_end: "2026-10-07T18:30:00.000Z",
    });
  });

  it("fails instead of claiming a total when the database aggregate fails", async () => {
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { rpc: vi.fn(async () => ({ data: null, error: { message: "database unavailable" } })) }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: "11111111-1111-4111-8111-111111111111", name: "Test shop" },
    } as never);

    await expect(repository.dailySales("2026-10-07")).rejects.toThrow("Sales summary is unavailable.");
  });

  it("pages exact legacy totals when the additive aggregate RPC is not deployed", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "function not found" } }));
    const firstPage = Array.from({ length: 1000 }, () => ({ total_amount: "15.00" }));
    const secondPage = [{ total_amount: "25.00" }];
    const ranges: [number, number][] = [];
    const from = vi.fn(() => {
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), gte: vi.fn(() => query), lt: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: start === 0 ? firstPage : secondPage, error: null };
        }),
      };
      return query;
    });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { rpc, from }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: "11111111-1111-4111-8111-111111111111", name: "Test shop" },
    } as never);

    await expect(repository.dailySales("2026-10-07")).resolves.toEqual({ total: 15025, count: 1001 });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("uses the right-exclusive Asia/Kolkata month range for exact summaries", async () => {
    const rpc = vi.fn(async () => ({ data: { total: 0, count: 0 }, error: null }));
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { rpc }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: "11111111-1111-4111-8111-111111111111", name: "Test shop" },
    } as never);

    await repository.monthlySales("2026-10");
    expect(rpc).toHaveBeenCalledWith("get_shop_sales_summary", {
      p_shop_id: "11111111-1111-4111-8111-111111111111",
      p_start: "2026-09-30T18:30:00.000Z", p_end: "2026-10-31T18:30:00.000Z",
    });
  });

  it("scopes the purchase-order migration probe to the authenticated shop", async () => {
    const shopId = "11111111-1111-4111-8111-111111111111";
    const filters: [string, string][] = [];
    const from = vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => { filters.push([column, value]); return query; }),
        limit: vi.fn(async () => ({ data: null, error: { code: "42703", message: "order_number column missing" } })),
      };
      return query;
    });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { from, rpc: vi.fn() }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: shopId, name: "Test shop" },
    } as never);

    await expect(repository.createOrderDraft("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", [], "cccccccc-cccc-4ccc-8ccc-cccccccccccc"))
      .rejects.toThrow("Purchase order creation is paused until the additive order-reference migration is applied.");
    expect(filters).toContainEqual(["shop_id", shopId]);
  });

  it("pages beyond the first PostgREST page when resolving saved purchase orders", async () => {
    const shopId = "11111111-1111-4111-8111-111111111111";
    const supplierId = "22222222-2222-4222-8222-222222222222";
    const orderRows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      order_number: `VL-PO-2026-${String(index + 1).padStart(6, "0")}`,
      total_amount: "0.00", supplier_id: supplierId, status: "draft", created_at: "2026-11-07T00:00:00.000Z",
    }));
    const orderRanges: [number, number][] = [];
    const itemRanges: [number, number][] = [];
    const from = vi.fn((table: string) => {
      let cursor = "";
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), gt: vi.fn((_column: string, value: string) => { cursor = value; return query; }), order: vi.fn(() => query), in: vi.fn(() => query),
        range: vi.fn(async (start: number, end: number) => {
          if (table === "purchase_orders") {
            orderRanges.push([start, end]);
            return { data: orderRows.filter((order) => order.id > cursor).slice(start, end + 1), error: null };
          }
          if (table === "purchase_order_items") {
            itemRanges.push([start, end]);
            return { data: [], error: null };
          }
          return { data: [], error: null };
        }),
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          const data = table === "suppliers" ? [{ id: supplierId, name: "North Market" }] : [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { from }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: shopId, name: "Test shop" },
    } as never);

    const orders = await repository.orders();
    expect(orders).toHaveLength(1001);
    expect(orders.find((order) => order.orderNumber === "VL-PO-2026-001001")?.id).toBe(orderRows[1000].id);
    expect(orderRanges).toEqual([[0, 999], [0, 999]]);
    expect(itemRanges).toHaveLength(11);
  });

  it("does not miss same-name customer identities beyond the PostgREST row cap", async () => {
    const shopId = "11111111-1111-4111-8111-111111111111";
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: "Rahul", customer_code: `VL-CU-${String(index + 1).padStart(6, "0")}`, phone: null,
    }));
    const ranges: [number, number][] = [];
    const from = vi.fn((table: string) => {
      let cursor = "";
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), gt: vi.fn((_column: string, value: string) => { cursor = value; return query; }), order: vi.fn(() => query),
        range: vi.fn(async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: table === "customers" ? rows.filter((row) => row.id > cursor).slice(start, end + 1) : [], error: null };
        }),
      };
      return query;
    });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { from }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: shopId, name: "Test shop" },
    } as never);

    const customers = await repository.customers();
    expect(customers).toHaveLength(1001);
    expect(customers[1000]).toEqual({ id: rows[1000].id, name: "Rahul", customerCode: "VL-CU-001001", phone: null });
    expect(ranges).toEqual([[0, 999], [0, 999]]);
  });

  it("loads the full auditable khata before calculating a balance", async () => {
    const shopId = "11111111-1111-4111-8111-111111111111";
    const customerId = "22222222-2222-4222-8222-222222222222";
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      type: "gave", amount: "1.00", note: null,
      created_at: new Date((1000 - index) * 1000).toISOString(),
    }));
    const ranges: [number, number][] = [];
    const filters: [string, string][] = [];
    const from = vi.fn(() => {
      let cursor = "";
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => { filters.push([column, value]); return query; }),
        gt: vi.fn((_column: string, value: string) => { cursor = value; return query; }),
        order: vi.fn(() => query),
        range: vi.fn(async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: rows.filter((row) => row.id > cursor).slice(start, end + 1), error: null };
        }),
      };
      return query;
    });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { from }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: shopId, name: "Test shop" },
    } as never);

    const entries = await repository.ledger(customerId);
    expect(entries).toHaveLength(1001);
    expect(entries[0].id).toBe(rows[1000].id);
    expect(entries.at(-1)?.id).toBe(rows[0].id);
    expect(filters).toContainEqual(["shop_id", shopId]);
    expect(filters).toContainEqual(["customer_id", customerId]);
    expect(ranges).toEqual([[0, 999], [0, 999]]);
  });
});
