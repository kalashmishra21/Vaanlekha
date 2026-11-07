import { describe, expect, it } from "vitest";
import { parseTextShoppingList } from "../src/lib/assistant/parse-text-list";
import { matchShoppingList } from "../src/lib/assistant/match-shopping-list";
import { OpenRouterVisionExtractor } from "../src/lib/ai/vision/openrouter-vision";

const catalog = [
  { id: "11111111-1111-4111-8111-111111111112", name: "Maggi", unit: "packet", currentStock: 10, sellingPrice: 15 },
  { id: "11111111-1111-4111-8111-111111111113", name: "Parle-G", unit: "packet", currentStock: 1, sellingPrice: 10 },
];

describe("shopping-list extraction and draft boundary", () => {
  it("extracts lines from a text PDF without remote OCR", () => {
    expect(parseTextShoppingList("Shopping list\nMaggi - 2 packets\nParle-G: ३ packs")).toEqual([
      { product: "Maggi", quantity: 2 }, { product: "Parle-G", quantity: 3 },
    ]);
  });

  it("prices matched lines and flags short and missing stock", () => {
    const draft = matchShoppingList([
      { product: "Maggi", quantity: 2 }, { product: "Parle-G", quantity: 3 }, { product: "Unknown", quantity: 1 },
    ], catalog);
    expect(draft).toMatchObject({ canConfirm: false, estimatedTotal: 60,
      items: [{ status: "available", unitPrice: 15, lineTotal: 30 }, { status: "short", stock: 1, lineTotal: 30 }, { status: "missing" }] });
  });

  it("keeps unreadable quantity rows visible and prevents an incomplete list from being confirmed", () => {
    const draft = matchShoppingList([{ product: "Maggi", quantity: null, unit: "packet" }], catalog);
    expect(draft).toMatchObject({ canConfirm: false, estimatedTotal: 0,
      items: [{ productId: catalog[0].id, status: "unit-unclear", unit: "packet", note: expect.stringContaining("could not be read") }] });
    expect(draft.items[0]).not.toHaveProperty("quantity");
  });

  it("converts clear document quantities to the saved inventory unit before comparing stock", () => {
    const draft = matchShoppingList([{ product: "Sugar", quantity: 500, unit: "g" }], [
      { id: "11111111-1111-4111-8111-111111111114", name: "Sugar", unit: "kg", currentStock: 1.25, sellingPrice: 40 },
    ]);
    expect(draft).toMatchObject({ canConfirm: true, estimatedTotal: 20,
      items: [{ quantity: 0.5, unit: "kg", status: "available", lineTotal: 20, stock: 1.25 }] });
  });

  it("validates vision JSON and detects provider errors inside HTTP 200", async () => {
    const image = [{ mimeType: "image/png" as const, bytes: new Uint8Array([137, 80, 78, 71]) }];
    const valid: typeof fetch = async () => Response.json({ choices: [{ message: { content: '{"items":[{"product":"Maggi","quantity":2}]}' } }] });
    await expect(new OpenRouterVisionExtractor("test-key", "test:free", valid).extract(image)).resolves.toEqual([{ product: "Maggi", quantity: 2 }]);
    const embeddedError: typeof fetch = async () => Response.json({ error: { code: 502, message: "Upstream unavailable" } });
    await expect(new OpenRouterVisionExtractor("test-key", "test:free", embeddedError, [], async () => {}).extract(image))
      .rejects.toMatchObject({ status: 502 });
    const invalid: typeof fetch = async () => Response.json({ choices: [{ message: { content: '{"items":[{"product":"Maggi","quantity":"2"}]}' } }] });
    await expect(new OpenRouterVisionExtractor("test-key", "test:free", invalid).extract(image)).rejects.toThrow();
  });

  it("retries capacity errors with backoff and falls back to another free provider", async () => {
    const calls: string[] = [];
    const delays: number[] = [];
    const request: typeof fetch = async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      calls.push(model);
      if (model === "primary:free") return Response.json({ error: { code: 429 } });
      return Response.json({ choices: [{ message: { content: '{"items":[{"product":"Maggi","quantity":2}]}' } }] });
    };
    const extractor = new OpenRouterVisionExtractor("test-key", "primary:free", request, ["fallback:free"], async (ms) => { delays.push(ms); });
    await expect(extractor.extract([{ mimeType: "image/png", bytes: new Uint8Array([1]) }])).resolves.toEqual([{ product: "Maggi", quantity: 2 }]);
    expect(calls).toEqual(["primary:free", "primary:free", "fallback:free"]);
    expect(delays).toEqual([700]);
  });

  it("uses a fallback for invalid extraction and fails closed if all providers fail", async () => {
    const image = [{ mimeType: "image/png" as const, bytes: new Uint8Array([1]) }];
    const invalid: typeof fetch = async (_url, init) => Response.json({ choices: [{ message: { content: JSON.parse(String(init?.body)).model === "primary:free"
      ? '{"items":[{"product":"Maggi","quantity":"two"}]}' : '{"items":[{"product":"Maggi","quantity":3}]}' } }] });
    await expect(new OpenRouterVisionExtractor("test-key", "primary:free", invalid, ["fallback:free"]).extract(image))
      .resolves.toEqual([{ product: "Maggi", quantity: 3 }]);
    const unavailable: typeof fetch = async () => new Response("", { status: 503 });
    await expect(new OpenRouterVisionExtractor("test-key", "primary:free", unavailable, ["fallback:free"], async () => {}).extract(image))
      .rejects.toMatchObject({ status: 503 });
  });

  it("stops on provider authorization failure without trying another model", async () => {
    let calls = 0;
    const unauthorized: typeof fetch = async () => { calls++; return new Response("", { status: 401 }); };
    await expect(new OpenRouterVisionExtractor("test-key", "primary:free", unauthorized, ["fallback:free"]).extract([
      { mimeType: "image/png", bytes: new Uint8Array([1]) },
    ])).rejects.toThrow("authorization failed");
    expect(calls).toBe(1);
  });

  it("moves immediately to a fallback when a model is retired", async () => {
    const calls: string[] = [];
    const request: typeof fetch = async (_url, init) => {
      const model = JSON.parse(String(init?.body)).model as string;
      calls.push(model);
      return model === "retired:free" ? new Response("", { status: 404 })
        : Response.json({ choices: [{ message: { content: '{"items":[{"product":"Maggi","quantity":1}]}' } }] });
    };
    await expect(new OpenRouterVisionExtractor("test-key", "retired:free", request, ["fallback:free"]).extract([
      { mimeType: "image/png", bytes: new Uint8Array([1]) },
    ])).resolves.toEqual([{ product: "Maggi", quantity: 1 }]);
    expect(calls).toEqual(["retired:free", "fallback:free"]);
  });
});
