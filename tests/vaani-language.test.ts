import { describe, expect, it } from "vitest";
import { GeminiReasoner } from "../src/lib/ai/reasoners/gemini";

const completion = (name: string, args: unknown) => Response.json({
  choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }],
});

describe("Vaani multilingual reasoning regressions", () => {
  const today = "2026-11-07";

  it.each([
    "aaj ki sale batao",
    "आज की बिक्री बताओ",
    "today's sale batao",
    "what is today's sale",
  ])("routes today's sales query to the real daily-sales tool for %s", async (text) => {
    let requests = 0;
    const reasoner = new GeminiReasoner("test-key", "gemini-3.5-flash-lite", async (_url, options) => {
      requests += 1;
      expect(String(options?.body)).toContain(today);
      return completion("sales_getDailySummary", { date: today });
    }, () => today);
    await expect(reasoner.reason({ text })).resolves.toMatchObject({
      kind: "tool_call", tool: { intent: "sales.getDailySummary", arguments: { date: today } },
    });
    expect(requests).toBe(1);
  });

  it("rejects a model date outside the Asia/Kolkata day boundary", async () => {
    const reasoner = new GeminiReasoner("test-key", "gemini-3.5-flash-lite",
      async () => completion("sales_getDailySummary", { date: "2026-11-06" }), () => "2026-11-07");
    await expect(reasoner.reason({ text: "What is today's sale?" })).resolves.toMatchObject({ kind: "clarify" });
  });

  it("sends explicit stock commands to Gemini before the trusted inventory boundary", async () => {
    for (const [text, product, delta] of [
      ["Maggi ke 20 packet add kar do", "Maggi", 20],
      ["Maggie ke 10 packets add karo", "Maggie", 10],
      ["Add 20 packets of Maggi", "Maggi", 20],
    ] as const) {
      let requests = 0;
      const reasoner = new GeminiReasoner("test-key", "gemini-3.5-flash-lite", async () => {
        requests += 1;
        return completion("inventory_adjust", { product, delta, unit: "packet" });
      }, () => today);
      await expect(reasoner.reason({ text })).resolves.toMatchObject({
        kind: "tool_call", tool: { intent: "inventory.adjust", arguments: { product, delta } },
      });
      expect(requests).toBe(1);
    }
  });
});
