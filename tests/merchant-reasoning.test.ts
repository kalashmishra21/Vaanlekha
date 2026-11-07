import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";

describe("merchant workflow reasoning", () => {
  it.each([
    ["Suppliers dikhao", "supplier.list", {}],
    ["New supplier Demo Wholesale add karo", "supplier.create", { name: "Demo Wholesale" }],
    ["Open orders dikhao", "orders.getOpen", {}],
    ["Low-stock items ki reorder list bana do", "inventory.getReorderSuggestions", {}],
    ["North Market Distributors se Maggi ke 10 packet ka purchase order draft banao", "orders.createDraft", { supplier: "North Market Distributors", items: [{ product: "Maggi", quantity: 10 }] }],
  ])("validates %s without network access", async (text, intent, args) => {
    expect(await new MockAIProvider().reason({ text: String(text) })).toEqual({ kind: "tool_call", tool: { intent, arguments: args } });
  });

  it.each([
    ["Rahul ne 100 rupaye ka udhaar liya", "gave", 100],
    ["Rahul ने 100 रुपये का उधार लिया", "gave", 100],
    ["Rahul ne sau rupaye ka udhaar liya", "gave", 100],
    ["Rahul ne 100 rupaye udhaar mein liya", "gave", 100],
    ["Rahul borrowed 100 rupees on credit", "gave", 100],
    ["Rahul ne 50 rupaye wapas kar diye", "received", 50],
    ["Rahul ने पचास रुपये वापस कर दिए", "received", 50],
    ["Rahul repaid 50 rupees", "received", 50],
  ] as const)("maps khata wording to the correct ledger type: %s", async (text, type, amount) => {
    const result = await new MockAIProvider().reason({ text });
    expect(result).toEqual({ kind: "tool_call", tool: { intent: "khata.addEntry", arguments: { customer: "Rahul", type, amountRupees: amount } } });
  });

  it("parses quantity-first supplier order requests", async () => {
    expect(await new MockAIProvider().reason({ text: "Test Supplier se 10 packets milk ka purchase order draft banao" })).toEqual({
      kind: "tool_call", tool: { intent: "orders.createDraft", arguments: { supplier: "Test Supplier", items: [{ product: "Milk", quantity: 10 }] } },
    });
  });
});
