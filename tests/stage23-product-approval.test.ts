import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { shouldContinuePending } from "../src/lib/assistant/merchant-language";

describe("saved product actions", () => {
  const provider = new MockAIProvider();

  for (const answer of ["25 की एक आइसक्रीम", "25 ki ek hai", "ice cream 25 per packet", "25 rupaye per packet", "पच्चीस रुपये प्रति पैकेट"]) {
    it(`creates the requested new item immediately after its price reply: ${answer}`, async () => {
      const first = await provider.reason({ text: "आइसक्रीम के 10 पैकेट ऐड करो" });
      expect(first).toMatchObject({ kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { delta: 10 } } });
      const restored = JSON.parse(JSON.stringify({ kind: "product-create-price", product: "आइसक्रीम", unit: "packet", openingStock: 10 }));
      expect(shouldContinuePending(restored, answer)).toBe(true);
      const second = await provider.reason({ text: answer, pending: restored });
      expect(second).toMatchObject({ kind: "tool_call", tool: { intent: "product.create", arguments: { name: "आइसक्रीम", openingStock: 10, sellingPrice: 25 } } });
    });
  }

  it("lets an unrelated request interrupt the saved action", async () => {
    const pending = { kind: "product-create-price", product: "आइसक्रीम", unit: "packet", openingStock: 10 };
    expect(shouldContinuePending(pending, "आज की बिक्री बताओ")).toBe(false);
    expect(shouldContinuePending(pending, "25 ki ek Milk")).toBe(false);
  });
});
