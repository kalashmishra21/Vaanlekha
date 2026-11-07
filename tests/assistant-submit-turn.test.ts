import { describe, expect, it, vi } from "vitest";
import { AssistantTurnLock, postAssistantTurn } from "../src/lib/assistant/submit-turn";

const answer = { state: "confirmed", title: "Stock", intent: "inventory.getStock", detail: "Milk", reply: "Milk has 12 packets." };

describe("Ask Vaani typed submission", () => {
  it("posts the composer text, conversation and idempotency key once", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(answer));
    const result = await postAssistantTurn({ text: "Milk stock batao", speak: false, recent: [], pending: null,
      conversationId: "11111111-1111-4111-8111-111111111111", idempotencyKey: "22222222-2222-4222-8222-222222222222" }, fetcher);
    expect(result.reply).toBe(answer.reply);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/assistant/turn");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("22222222-2222-4222-8222-222222222222");
    expect(JSON.parse(String(init?.body))).toMatchObject({ text: "Milk stock batao", conversationId: "11111111-1111-4111-8111-111111111111" });
  });

  it("does not send empty text and shows safe API errors", async () => {
    const fetcher = vi.fn();
    await expect(postAssistantTurn({ text: "  ", speak: false, recent: [], pending: null, idempotencyKey: "key" }, fetcher)).rejects.toThrow("Enter a message");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(postAssistantTurn({ text: "Milk", speak: false, recent: [], pending: null, idempotencyKey: "key" },
      async () => Response.json({ error: "Conversation unavailable." }, { status: 503 }))).rejects.toThrow("Conversation unavailable.");
  });

  it("collapses repeated submits while the first request is still running", async () => {
    const lock = new AssistantTurnLock();
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false);
    lock.release();
    expect(lock.acquire()).toBe(true);
  });
});
