import { describe, expect, it, vi } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { BusinessToolExecutor, type BusinessRepository } from "../src/server/tools/business-executor";

const sugar = { id: "11111111-1111-4111-8111-111111111114", name: "चीनी", unit: "kg", currentStock: 10, sellingPrice: 40 };
function repository() {
  const adjustStock = vi.fn(async (_id: string, delta: number) => sugar.currentStock + delta);
  const recordSale = vi.fn();
  return { source: { products: async () => [sugar], adjustStock, recordSale } as unknown as BusinessRepository, adjustStock, recordSale };
}

describe("vernacular assistant actions", () => {
  it("drafts 2.5 kg sugar at ₹40/kg for ₹100 without saving", async () => {
    const proposed = await new MockAIProvider().reason({ text: "ढाई किलो चीनी 40 रुपये किलो के हिसाब से बेच दो" });
    expect(proposed).toMatchObject({ kind: "tool_call", tool: { intent: "sales.prepareSpoken" } });
    if (proposed.kind !== "tool_call") throw new Error("Expected spoken sale proposal");
    const fake = repository();
    const result = await new BusinessToolExecutor(fake.source).execute(proposed.tool);
    expect(result).toMatchObject({ ok: true, data: { draft: { source: "spoken-sale", estimatedTotal: 100,
      canConfirm: true, items: [{ quantity: 2.5, unit: "kg", lineTotal: 100 }] } } });
    expect(fake.recordSale).not.toHaveBeenCalled();
  });

  it("converts 250 g to 0.25 kg before adjusting the saved product", async () => {
    const proposed = await new MockAIProvider().reason({ text: "250 g चीनी add karo" });
    expect(proposed).toMatchObject({ kind: "tool_call", tool: { intent: "inventory.adjust" } });
    if (proposed.kind !== "tool_call") throw new Error("Expected stock proposal");
    const fake = repository();
    const result = await new BusinessToolExecutor(fake.source).execute(proposed.tool);
    expect(result).toMatchObject({ ok: true, data: { delta: 0.25, newStock: 10.25 } });
    expect(fake.adjustStock).toHaveBeenCalledWith(sugar.id, 0.25, expect.any(String));
  });

  it("asks for units instead of guessing what paav oil means", async () => {
    const result = await new MockAIProvider().reason({ text: "पाव तेल देना" });
    expect(result).toMatchObject({ kind: "clarify" });
    if (result.kind !== "clarify") throw new Error("Expected unit clarification");
    expect(result.question).toContain("250 ml");
  });
});
