import { describe, expect, it } from "vitest";
import { MockAIProvider } from "../src/lib/ai/providers/mock";
import { pendingClarificationSchema } from "../src/lib/ai/types/tool-call";
import { shouldContinuePending } from "../src/lib/assistant/merchant-language";

const provider = new MockAIProvider(() => "2026-10-11");

describe("Stage 16 pending-request boundaries", () => {
  it.each([
    { pending: { kind: "customer-name" }, text: "tell me a joke" },
    { pending: { kind: "customer-name" }, text: "how much does Sharma owe?" },
    { pending: { kind: "customer-name" }, text: "100 rupaye" },
    { pending: { kind: "customer-name" }, text: "आज की बिक्री बताओ" },
    { pending: { kind: "supplier-name" }, text: "what is the time" },
    { pending: { kind: "order-supplier", items: [{ product: "Maggi", quantity: 10 }] }, text: "Aaj ki sale batao" },
    { pending: { kind: "order-transition-select", query: "order", action: "place", candidates: [
      { id: "11111111-1111-4111-8111-111111111111", orderNumber: "VL-PO-2026-000001", supplier: "North Market", orderDate: "2026-11-01T00:00:00.000Z", items: ["Maggi × 2"], status: "draft" },
      { id: "22222222-2222-4222-8222-222222222222", orderNumber: "VL-PO-2026-000002", supplier: "Everyday Supply", orderDate: "2026-11-02T00:00:00.000Z", items: ["Milk × 3"], status: "draft" },
    ] }, text: "#" },
  ] as const)("does not complete a pending request with an unrelated message: $text", async ({ pending, text }) => {
    expect(shouldContinuePending(pending, text)).toBe(false);
    const result = await provider.reason({ text, pending: pendingClarificationSchema.parse(pending) });
    expect(result.kind === "tool_call" && ["customer.create", "supplier.create", "orders.createDraft"].includes(result.tool.intent)).toBe(false);
  });

  it.each([
    { pending: { kind: "customer-name" }, text: "Amit Kumar", intent: "customer.create" },
    { pending: { kind: "supplier-name" }, text: "North Market Distributors", intent: "supplier.create" },
    { pending: { kind: "order-supplier", items: [{ product: "Maggi", quantity: 10 }] }, text: "North Market Distributors", intent: "orders.createDraft" },
  ] as const)("accepts a clear follow-up name: $text", async ({ pending, text, intent }) => {
    expect(shouldContinuePending(pending, text)).toBe(true);
    await expect(provider.reason({ text, pending: pendingClarificationSchema.parse(pending) })).resolves.toMatchObject({ kind: "tool_call", tool: { intent } });
  });
});
