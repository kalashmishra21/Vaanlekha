import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { SupabaseBusinessRepository } from "../src/server/data/tool-repository";

describe("daily sales data boundary", () => {
  it("queries the authenticated shop for the complete Asia/Kolkata business day and sums saved totals", async () => {
    const result = { data: [{ total_amount: "250.00" }, { total_amount: "60.00" }], error: null };
    const query = {
      select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lt.mockResolvedValue(result);
    const client = { from: vi.fn(() => query) };
    const shopId = "11111111-1111-4111-8111-111111111111";
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", shop: { id: shopId, name: "Test shop" },
    } as never);

    await expect(repository.dailySales("2026-10-07")).resolves.toEqual({ total: 310, count: 2 });
    expect(client.from).toHaveBeenCalledWith("sales");
    expect(query.select).toHaveBeenCalledWith("total_amount");
    expect(query.eq).toHaveBeenCalledWith("shop_id", shopId);
    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-10-06T18:30:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("created_at", "2026-10-07T18:30:00.000Z");
  });

  it("fails instead of claiming a total when the database query fails", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), gte: vi.fn(), lt: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lt.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client: { from: vi.fn(() => query) }, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: "11111111-1111-4111-8111-111111111111", name: "Test shop" },
    } as never);

    await expect(repository.dailySales("2026-10-07")).rejects.toThrow("Sales summary is unavailable.");
  });
});
