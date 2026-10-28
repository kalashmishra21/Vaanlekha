import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiReasoner } from "../src/lib/ai/reasoners/gemini";
import { createAIProvider } from "../src/lib/ai/provider";
import { MockAIProvider } from "../src/lib/ai/providers/mock";

const completion = (name: string, args: unknown) => Response.json({
  choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
});

describe("optional Gemini reasoner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the free-tier Gemini endpoint and validates proposed tool arguments", async () => {
    const request: typeof fetch = async (url, options) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
      expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer test-key");
      expect(JSON.parse(String(options?.body)).model).toBe("gemini-3.5-flash-lite");
      return completion("inventory_adjust", { product: "Maggi", delta: 20, unit: "packet" });
    };
    const reasoner = new GeminiReasoner("test-key", "gemini-3.5-flash-lite", request);
    await expect(reasoner.reason({ text: "Increase Maggi inventory by twenty packets" })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { product: "Maggi", delta: 20 } },
    });
  });

  it("sends a polite stock command to the reasoner without inventing a product name", async () => {
    const text = "Please increase Maggi inventory by five packets";
    expect(await new MockAIProvider().reason({ text })).toMatchObject({ kind: "unsupported" });
    const request: typeof fetch = async () => completion("inventory_adjust", { product: "Maggi", delta: 5, unit: "packet" });
    await expect(new GeminiReasoner("test-key", "gemini-3.5-flash-lite", request).reason({ text }))
      .resolves.toMatchObject({ kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { product: "Maggi", delta: 5 } } });
  });

  it("grounds a Hindi supplier-directory request with a plural English noun", async () => {
    const request: typeof fetch = async () => completion("supplier_list", {});
    await expect(new GeminiReasoner("test-key", "gemini-3.5-flash-lite", request)
      .reason({ text: "हमारे suppliers की सूची दिखाओ" }))
      .resolves.toMatchObject({ kind: "tool_call", tool: { intent: "supplier.list" } });
  });

  it("falls back to OpenRouter on Gemini outage and preserves the same trusted-tool schema", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      return url.includes("generativelanguage")
        ? new Response(null, { status: 503 })
        : completion("inventory_adjust", { product: "Maggi", delta: 20 });
    });
    const provider = createAIProvider({ AI_PROVIDER: "mock", AI_REASONER: "gemini", GEMINI_API_KEY: "test-gemini",
      OPENROUTER_API_KEY: "test-router", OPENROUTER_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free" });
    await expect(provider.reason({ text: "Increase Maggi inventory by twenty packets" })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { delta: 20 } },
    });
    expect(requests.filter((url) => url.includes("generativelanguage"))).toHaveLength(2);
    expect(requests.at(-1)).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("requires both server-side keys in Gemini mode", () => {
    expect(() => createAIProvider({ AI_PROVIDER: "mock", AI_REASONER: "gemini", OPENROUTER_API_KEY: "router" }))
      .toThrow("GEMINI_API_KEY");
    expect(() => createAIProvider({ AI_PROVIDER: "mock", AI_REASONER: "gemini", GEMINI_API_KEY: "gemini" }))
      .toThrow("OPENROUTER_API_KEY");
  });
});
