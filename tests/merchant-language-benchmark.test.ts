import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { parseMerchantNumber } from "../src/lib/assistant/merchant-language";
import { toolCallSchema } from "../src/lib/ai/types/tool-call";

const cases: Array<{ text: string; kind: "tool_call" | "clarify" | "unsupported"; intent?: string }> = [
  { text: "Maggi ke 20 packet add kar do", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Maggi ke 20 packets add kro", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Maggi ke bees packet jodo", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Maggi ke 50 packet add kro", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Bread ke pachaas packet add kro", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Add 2 packets of Maggi to inventory", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Add five packets of Maggi to stock", kind: "tool_call", intent: "inventory.adjust" },
  { text: "Add 12 units of Amul Milk to inventory", kind: "tool_call", intent: "inventory.adjust" },
  { text: "What is the stock of Maggi?", kind: "tool_call", intent: "inventory.getStock" },
  { text: "Show me the stock of Maggi", kind: "tool_call", intent: "inventory.getStock" },
  { text: "How many packets of Maggi are in stock?", kind: "tool_call", intent: "inventory.getStock" },
  { text: "मैगी का स्टॉक बताओ", kind: "tool_call", intent: "inventory.getStock" },
  { text: "Maggi ka stock batao", kind: "tool_call", intent: "inventory.getStock" },
  { text: "Sharma ji ka kitna udhaar hai?", kind: "tool_call", intent: "khata.getBalance" },
  { text: "शर्मा जी का कितना उधार है?", kind: "tool_call", intent: "khata.getBalance" },
  { text: "How much does Sharma ji owe?", kind: "tool_call", intent: "khata.getBalance" },
  { text: "Nandini ke naam se 100 rupaye ka naya udhaar khata bana do", kind: "tool_call", intent: "khata.openAccount" },
  { text: "Nandini naam se customer add karo udhaar wala", kind: "clarify" },
  { text: "Mahi ke ek sau rupaye udhaar me add kro", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Mahi ke sau rupaye udhaar me add kro", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Mahi ke 100 rupees udhaar me add kro", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Mahi ke 100 Rs udhaar me add kro", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Mahi ke 100 rupae udhar mein add kro", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Mahi ko 50 rupaye udhaar likh do", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Nandini ne 50 rupaye wapas diye", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Priya ne pachaas rupaye wapas diye", kind: "tool_call", intent: "khata.addEntry" },
  { text: "Sanket ke 100 $ udhaar me add kro", kind: "clarify" },
  { text: "Sanket ke 100 dollars udhaar me add kro", kind: "clarify" },
  { text: "customer add karo", kind: "clarify" },
  { text: "Suppliers dikhao", kind: "tool_call", intent: "supplier.list" },
  { text: "Supplier list", kind: "tool_call", intent: "supplier.list" },
  { text: "New supplier Demo Wholesale add karo", kind: "tool_call", intent: "supplier.create" },
  { text: "Supplier add karo", kind: "clarify" },
  { text: "Open orders dikhao", kind: "tool_call", intent: "orders.getOpen" },
  { text: "Purchase orders dikhao", kind: "tool_call", intent: "orders.getOpen" },
  { text: "Reorder suggestions batao", kind: "tool_call", intent: "inventory.getReorderSuggestions" },
  { text: "Low-stock items ki reorder list bana do", kind: "tool_call", intent: "inventory.getReorderSuggestions" },
  { text: "North Market Distributors se Maggi ke 10 packet ka purchase order draft banao", kind: "tool_call", intent: "orders.createDraft" },
  { text: "Maggi ka order 10 packet de do", kind: "clarify" },
  { text: "Amul Milk ka order 10 packet de do", kind: "clarify" },
  { text: "Amul Milk ke 10 packet order kar do", kind: "clarify" },
  { text: "Amul Milk ka order status batao", kind: "tool_call", intent: "orders.getStatus" },
  { text: "Order 123 place karo", kind: "tool_call", intent: "orders.transition" },
  { text: "Order 123 receive karo", kind: "tool_call", intent: "orders.transition" },
  { text: "Order 123 cancel karo", kind: "tool_call", intent: "orders.transition" },
  { text: "Aaj ki sale batao", kind: "tool_call", intent: "sales.getDailySummary" },
  { text: "Aaj ki total sale batao", kind: "tool_call", intent: "sales.getDailySummary" },
  { text: "What are today's sales?", kind: "tool_call", intent: "sales.getDailySummary" },
  { text: "आज की बिक्री बताओ", kind: "tool_call", intent: "sales.getDailySummary" },
  { text: "Shopping list: Maggi 2, Parle-G 3", kind: "tool_call", intent: "inventory.checkList" },
  { text: "Kuchh maal adjust kar do", kind: "clarify" },
  { text: "Tell me a joke", kind: "unsupported" },
  { text: "50 packet of Bread add kro new inventory h ye", kind: "clarify" },
];

describe("offline merchant-language benchmark", () => {
  it("covers at least 40 synthetic commands with schema-valid tool proposals", async () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const provider = new MockAIProvider(() => "2026-10-09");
    const failures: string[] = [];
    for (const scenario of cases) {
      const result = await provider.reason({ text: scenario.text });
      if (result.kind !== scenario.kind || (scenario.intent && (result.kind !== "tool_call" || result.tool.intent !== scenario.intent))) {
        failures.push(`${scenario.text} => ${JSON.stringify(result)}; wanted ${scenario.kind}${scenario.intent ? `/${scenario.intent}` : ""}`);
        continue;
      }
      if (result.kind === "tool_call") expect(toolCallSchema.safeParse(result.tool).success, scenario.text).toBe(true);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("parses Hindi and Hinglish number spellings consistently", () => {
    expect(parseMerchantNumber("ek sau")).toBe(100);
    expect(parseMerchantNumber("sau")).toBe(100);
    expect(parseMerchantNumber("so")).toBe(100);
    expect(parseMerchantNumber("pachas")).toBe(50);
    expect(parseMerchantNumber("पचास")).toBe(50);
    expect(parseMerchantNumber("२०")).toBe(20);
  });

  it("completes product price, khata permission, currency and order action only from pending context", async () => {
    const provider = new MockAIProvider();
    const product = await provider.reason({ text: "50 packet of Bread add kro new inventory h ye" });
    expect(product).toMatchObject({ kind: "clarify", pending: { kind: "product-create-price", product: "Bread", unit: "packet", openingStock: 50 } });
    if (product.kind !== "clarify" || !product.pending) throw new Error("Expected product price clarification");
    const productConfirmation = await provider.reason({ text: "₹18 per packet", pending: product.pending });
    expect(productConfirmation).toMatchObject({ kind: "clarify", pending: { kind: "product-create-confirm", sellingPrice: 18 } });
    if (productConfirmation.kind !== "clarify" || !productConfirmation.pending) throw new Error("Expected product approval");
    await expect(provider.reason({ text: "haan", pending: productConfirmation.pending })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "product.create", arguments: { name: "Bread", unit: "packet", sellingPrice: 18, openingStock: 50 } },
    });

    const currency = await provider.reason({ text: "Sanket ke 100 $ udhaar me add kro" });
    expect(currency).toMatchObject({ kind: "clarify", pending: { kind: "khata-currency-confirm", amountRupees: 100 } });
    if (currency.kind !== "clarify" || !currency.pending) throw new Error("Expected currency clarification");
    await expect(provider.reason({ text: "haan, INR", pending: currency.pending })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "khata.addEntry", arguments: { type: "gave", amountRupees: 100 } },
    });

    const order = await provider.reason({ text: "Amul Milk ka order 10 packet de do" });
    expect(order).toMatchObject({ kind: "clarify", pending: { kind: "order-supplier", items: [{ product: "Amul Milk", quantity: 10 }] } });
    if (order.kind !== "clarify" || !order.pending) throw new Error("Expected supplier clarification");
    await expect(provider.reason({ text: "North Market Distributors", pending: order.pending })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "orders.createDraft", arguments: { supplier: "North Market Distributors" } },
    });

    const transition = await provider.reason({ text: "Order 123 place karo" });
    expect(transition).toMatchObject({ kind: "tool_call", tool: { intent: "orders.transition" } });
  });
});
