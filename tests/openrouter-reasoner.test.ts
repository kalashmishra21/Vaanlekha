import { describe, expect, it } from "vitest";
import { OpenRouterReasoner } from "../src/lib/ai/reasoners/openrouter";

const model = "nvidia/nemotron-3-ultra-550b-a55b:free";
const completion = (name: string, args: unknown) => Response.json({
  choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
});

describe("OpenRouter reasoner trust boundary", () => {
  it("checks quota for each clear non-conversation request sent to the model", async () => {
    let quotaChecks = 0;
    const request: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: 20 });
    const reasoner = new OpenRouterReasoner("test-key", model, request, () => "2026-10-08", async () => { quotaChecks += 1; });
    await reasoner.reason({ text: "Maggi ke 20 packet add kar do" });
    expect(quotaChecks).toBe(1);
    await reasoner.reason({ text: "Increase Maggi inventory by twenty packets" });
    expect(quotaChecks).toBe(2);
  });

  it("proposes one Zod-valid tool call without executing it", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const request: typeof fetch = async (url, options) => {
      expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer test-key");
      requestBody = JSON.parse(String(options?.body));
      return completion("inventory_adjust", { product: "Maggi", delta: 20 });
    };
    const reasoner = new OpenRouterReasoner("test-key", model, request, () => "2026-10-08");
    await expect(reasoner.reason({ text: "Increase Maggi inventory by twenty packets" })).resolves.toEqual({
      kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { product: "Maggi", delta: 20 } },
    });
    expect(requestBody?.model).toBe(model);
    expect(requestBody?.tool_choice).toBe("auto");
    expect(Array.isArray(requestBody?.tools)).toBe(true);
  });

  it("rejects an invalid amount and extra arguments before any trusted tool", async () => {
    const request: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: "20", shopId: "other-shop" });
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text: "Add Maggi" })).rejects.toThrow();
  });

  it("does not turn a text-only completion into a tool action", async () => {
    const request: typeof fetch = async () => Response.json({ choices: [{ message: { content: "Done!" } }] });
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text: "Update my stock please" })).resolves.toEqual({
      kind: "unsupported", message: "No safe intent was identified.",
    });
  });

  it("rejects multiple actions and upstream errors", async () => {
    const multiple: typeof fetch = async () => Response.json({ choices: [{ message: { tool_calls: [
      { function: { name: "inventory_adjust", arguments: '{"product":"Maggi","delta":20}' } },
      { function: { name: "khata_getBalance", arguments: '{"customer":"Sharma ji"}' } },
    ] } }] });
    await expect(new OpenRouterReasoner("test-key", model, multiple).reason({ text: "Do both" })).rejects.toThrow("multiple actions");
    const unavailable: typeof fetch = async () => new Response(null, { status: 429 });
    await expect(new OpenRouterReasoner("test-key", model, unavailable).reason({ text: "Maggi" })).rejects.toThrow("429");
  });

  it("validates new khata, repayment and shopping-list tools", async () => {
    const scenarios = [
      ["khata_openAccount", { customer: "Nandini", amountRupees: 100 }, "khata.openAccount", "Open Nandini's khata with 100 rupees"],
      ["khata_addEntry", { customer: "Nandini", type: "received", amountRupees: 50 }, "khata.addEntry", "Nandini paid 50 rupees"],
      ["inventory_checkList", { items: [{ product: "Maggi", quantity: 2 }] }, "inventory.checkList", "Check shopping list Maggi 2"],
    ] as const;
    for (const [name, args, intent, text] of scenarios) {
      const request: typeof fetch = async () => completion(name, args);
      await expect(new OpenRouterReasoner("test-key", model, request).reason({ text })).resolves.toMatchObject({
        kind: "tool_call", tool: { intent, arguments: args },
      });
    }
  });

  it.each(["hi", "hii", "hello", "Hello!", "namaste"])("never sends greeting %s to a model or proposes a store action", async (text) => {
    const request: typeof fetch = async () => { throw new Error("Greeting must not reach OpenRouter"); };
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text })).resolves.toMatchObject({ kind: "unsupported" });
  });

  it("asks to clarify an ambiguous transcript instead of accepting invented stock", async () => {
    const request: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: 200 });
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text: "add maybe Maggi" }))
      .resolves.toMatchObject({ kind: "clarify" });
  });

  it("rejects invented product and quantity even when the utterance mentions inventory", async () => {
    const request: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: 200 });
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text: "please add an item to inventory" }))
      .resolves.toMatchObject({ kind: "clarify" });
  });

  it("clarifies a model-proposed mutation whose direction conflicts with the merchant", async () => {
    const stockRequest: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: -20 });
    await expect(new OpenRouterReasoner("test-key", model, stockRequest).reason({ text: "Add 20 Maggi packets" }))
      .resolves.toMatchObject({ kind: "clarify" });
    const ledgerRequest: typeof fetch = async () => completion("khata_addEntry", { customer: "Nandini", type: "gave", amountRupees: 50 });
    await expect(new OpenRouterReasoner("test-key", model, ledgerRequest).reason({ text: "Nandini paid 50 rupees" }))
      .resolves.toMatchObject({ kind: "clarify" });
  });

  it("clarifies uncertain Prisma-style text before any provider call", async () => {
    const request: typeof fetch = async () => { throw new Error("Unclear transcript must not reach the model"); };
    await expect(new OpenRouterReasoner("test-key", model, request).reason({ text: "maybe Maggi ke 200 packet add kar do" }))
      .resolves.toMatchObject({ kind: "clarify" });
  });

  it("never saves a model-invented pending customer name", async () => {
    const request: typeof fetch = async () => completion("clarify_openAccount", { customer: "Maggi" });
    const result = await new OpenRouterReasoner("test-key", model, request).reason({ text: "open an udhaar khata" });
    expect(result.kind).toBe("clarify");
    expect("pending" in result).toBe(false);
  });

  it("asks for an opening amount and validates the follow-up after a second model call", async () => {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls += 1;
      return calls === 1
        ? completion("clarify_openAccount", { customer: "Nandini" })
        : completion("continue_pending", {});
    };
    const reasoner = new OpenRouterReasoner("test-key", model, request);
    const first = await reasoner.reason({ text: "Nandini naam se customer add karo udhaar wala" });
    expect(first).toMatchObject({ kind: "clarify", pending: { customer: "Nandini" } });
    if (first.kind !== "clarify") throw new Error("Expected clarification");
    await expect(reasoner.reason({ text: "100 rupaye", pending: first.pending })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "khata.openAccount", arguments: { customer: "Nandini", amountRupees: 100 } },
    });
    expect(calls).toBe(2);
  });

  it("does not substitute local mock reasoning when the provider is unavailable", async () => {
    const unavailable: typeof fetch = async () => { throw new Error("Provider unavailable"); };
    const reasoner = new OpenRouterReasoner("test-key", model, unavailable, () => "2026-10-08");
    await expect(reasoner.reason({ text: "Nandini ke naam se 100 rupaye ka naya udhaar khata bana do" })).rejects.toMatchObject({ status: 503 });
    await expect(reasoner.reason({ text: "Nandini ne 50 rupaye wapas diye" })).rejects.toMatchObject({ status: 503 });
  });

  it("executes a saved new-product price answer immediately through the trusted pending parser", async () => {
    const request: typeof fetch = async () => completion("continue_pending", {});
    await expect(new OpenRouterReasoner("test-key", model, request).reason({
      text: "20", pending: { kind: "product-create-price", product: "Maggi", unit: "packet", openingStock: 10 },
    })).resolves.toEqual({ kind: "tool_call", tool: { intent: "product.create", arguments: {
      name: "Maggi", unit: "packet", sellingPrice: 20, openingStock: 10, threshold: 5,
    } } });
  });

  it("rejects pending continuation when the current request is unrelated", async () => {
    const request: typeof fetch = async () => completion("continue_pending", {});
    await expect(new OpenRouterReasoner("test-key", model, request).reason({
      text: "What is today's sale?", pending: { kind: "product-create-price", product: "Maggi", unit: "packet", openingStock: 10 },
    })).resolves.toMatchObject({ kind: "clarify" });
  });
});
