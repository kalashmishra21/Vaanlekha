import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("assistant conversation presentation", () => {
  it("aligns user bubbles right and Vaani bubbles left with compact inline statuses", () => {
    const css = readFileSync("src/app/stage22.css", "utf8");
    expect(css).toContain(".conversation-feed .conversation-entry:has(.shopping-draft)");
    expect(css).toMatch(/\.conversation-feed \.conversation-entry:has\(\.shopping-draft\) \{[\s\S]*?align-items: flex-start/);
    expect(css).toMatch(/\.conversation-feed \.conversation-entry\.user \{ align-items: flex-end/);
    expect(css).toContain(".conversation-bottom .pending-clarification");
    expect(css).toContain(".conversation-feed .conversation-entry[data-state=\"failed\"] .conversation-body");
    expect(css).toContain(".conversation-feed .conversation-result");
  });

  it("keeps history results, shopping drafts and the inline price card in the chat feed", () => {
    const workspace = readFileSync("src/components/assistant/assistant-workspace.tsx", "utf8");
    expect(workspace).toContain("result: message.result ?? undefined");
    expect(workspace).toContain("<ShoppingListResult");
    expect(workspace).toContain("<PendingProductPriceCard");
    expect(workspace).toContain('pending?.kind === "product-create-price"');
  });
});
