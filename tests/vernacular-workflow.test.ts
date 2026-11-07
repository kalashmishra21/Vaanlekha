import { describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { BusinessToolExecutor, type BusinessRepository } from "../src/server/tools/business-executor";

const sugar = { id: "11111111-1111-4111-8111-111111111114", name: "चीनी", unit: "kg", currentStock: 10, sellingPrice: 40 };
function repository() {
  const product = { ...sugar };
  const adjustStock = vi.fn(async (_id: string, delta: number) => {
    product.currentStock += delta;
    return product.currentStock;
  });
  const recordSale = vi.fn(async (items: { productId: string; quantity: number; expectedUnitPrice?: number }[]) => {
    product.currentStock -= items.reduce((sum, item) => sum + item.quantity, 0);
    return { saleId: "11111111-1111-4111-8111-111111111115", total: 100 };
  });
  return { source: { products: async () => [product], adjustStock, recordSale } as unknown as BusinessRepository, adjustStock, recordSale };
}

describe("vernacular assistant actions", () => {
  it("retains a pending product and quantity when the price reply uses its short name", async () => {
    const provider = new MockAIProvider();
    const pending = { kind: "product-create-price" as const, product: "Test Kulfi", unit: "packet", openingStock: 10 };
    const confirmed = await provider.reason({ text: "25 ki ek kulfi", pending });
    expect(confirmed).toMatchObject({ kind: "tool_call", tool: { intent: "product.create", arguments: { name: "Test Kulfi", openingStock: 10, sellingPrice: 25 } } });
    const unrelated = await provider.reason({ text: "25 ki ek samosa", pending });
    expect(unrelated).not.toMatchObject({ tool: { intent: "product.create", arguments: { name: "Test Kulfi" } } });
  });
  it("records a clear 2.5 kg Hindi sale once and reports the saved inventory", async () => {
    const proposed = await new MockAIProvider().reason({ text: "ढाई किलो चीनी 40 रुपये किलो के हिसाब से बेच दो" });
    expect(proposed).toMatchObject({ kind: "tool_call", tool: { intent: "sales.recordSpoken" } });
    if (proposed.kind !== "tool_call") throw new Error("Expected spoken sale proposal");
    const fake = repository();
    const result = await new BusinessToolExecutor(fake.source).execute(proposed.tool);
    expect(result).toMatchObject({ ok: true, data: { intent: "sales.recordSpoken", saleId: "11111111-1111-4111-8111-111111111115",
      total: 100, stocks: [{ product: "चीनी", unit: "kg", stock: 7.5 }] } });
    expect(fake.recordSale).toHaveBeenCalledTimes(1);
  });

  it("converts an explicit 250 g addition to 0.25 kg and saves without an extra confirmation", async () => {
    const proposed = await new MockAIProvider().reason({ text: "250 g चीनी add karo" });
    expect(proposed).toMatchObject({ kind: "tool_call", tool: { intent: "inventory.adjust" } });
    if (proposed.kind !== "tool_call") throw new Error("Expected stock proposal");
    const fake = repository();
    const executor = new BusinessToolExecutor(fake.source);
    const result = await executor.execute(proposed.tool);
    expect(result).toMatchObject({ ok: true, data: { delta: 0.25, newStock: 10.25 } });
    expect(fake.adjustStock).toHaveBeenCalledWith(sugar.id, 0.25, expect.any(String));
    expect(fake.adjustStock).toHaveBeenCalledTimes(1);
  });

  it("asks for units instead of guessing what paav oil means", async () => {
    const result = await new MockAIProvider().reason({ text: "पाव तेल देना" });
    expect(result).toMatchObject({ kind: "clarify" });
    if (result.kind !== "clarify") throw new Error("Expected unit clarification");
    expect(result.question).toContain("250 ml");
  });
});
