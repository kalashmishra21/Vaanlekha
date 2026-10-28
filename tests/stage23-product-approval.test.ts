import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { shouldContinuePending } from "../src/lib/assistant/merchant-language";

describe("saved product action approval", () => {
  const provider = new MockAIProvider();

  for (const answer of ["25 की एक आइसक्रीम", "25 ki ek hai", "ice cream 25 per packet", "25 rupaye per packet", "पच्चीस रुपये प्रति पैकेट"]) {
    it(`keeps the ten-packet action pending for ${answer}`, async () => {
      const first = await provider.reason({ text: "आइसक्रीम के 10 पैकेट ऐड करो" });
      expect(first).toMatchObject({ kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { delta: 10 } } });
      const restored = JSON.parse(JSON.stringify({ kind: "product-create-price", product: "आइसक्रीम", unit: "packet", openingStock: 10 }));
      expect(shouldContinuePending(restored, answer)).toBe(true);
      const second = await provider.reason({ text: answer, pending: restored });
      expect(second).toMatchObject({ kind: "clarify", pending: { kind: "product-create-confirm", openingStock: 10, sellingPrice: 25 } });
      if (second.kind !== "clarify" || !second.pending) throw new Error("Expected approval question");
      const third = await provider.reason({ text: "हाँ", pending: JSON.parse(JSON.stringify(second.pending)) });
      expect(third).toMatchObject({ kind: "tool_call", tool: { intent: "product.create", arguments: { openingStock: 10, sellingPrice: 25 } } });
    });
  }

  it("lets an unrelated request interrupt the saved action", async () => {
    const pending = { kind: "product-create-price", product: "आइसक्रीम", unit: "packet", openingStock: 10 };
    expect(shouldContinuePending(pending, "आज की बिक्री बताओ")).toBe(false);
    expect(shouldContinuePending(pending, "25 ki ek Milk")).toBe(false);
  });
});
