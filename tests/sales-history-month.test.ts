import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { SupabaseBusinessRepository } from "../src/server/data/tool-repository";

describe("monthly sales history bounds", () => {
  it("includes the whole requested India month and excludes the next month", async () => {
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), gte: vi.fn(), lt: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    query.gte.mockReturnValue(query);
    query.lt.mockResolvedValue({ data: [], error: null });
    Object.assign(query, { then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) });
    const client = { from: vi.fn(() => query) };
    const repository = new SupabaseBusinessRepository({
      kind: "ready", client, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      shop: { id: "11111111-1111-4111-8111-111111111111", name: "Test shop" },
    } as never);

    await expect(repository.salesHistory({ month: "2026-10" })).resolves.toEqual([]);
    expect(query.gte).toHaveBeenCalledWith("created_at", "2026-09-30T18:30:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("created_at", "2026-10-31T18:30:00.000Z");
  });
});
