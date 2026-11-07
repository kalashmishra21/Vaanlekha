import { describe, expect, it, vi } from "vitest";
import type { ShopContext } from "../src/server/data/context";

vi.mock("server-only", () => ({}));

import { AssistantConversationRepository } from "../src/server/data/assistant-conversations";

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

describe("assistant conversation history window", () => {
  it("loads the latest 300 messages and displays them oldest to newest", async () => {
    const allMessages = Array.from({ length: 301 }, (_, index) => ({
      id: uuid(index + 1), role: index % 2 ? "assistant" : "user", text: `Turn ${index + 1}`,
      request_key: uuid(index + 1), result: null,
      created_at: new Date(Date.UTC(2026, 9, 11, 0, 0, index)).toISOString(),
    }));
    const orders: { field: string; ascending: boolean }[] = [];
    const messageQuery = {
      select() { return this; },
      eq() { return this; },
      order(field: string, options?: { ascending?: boolean }) {
        orders.push({ field, ascending: options?.ascending ?? true });
        return this;
      },
      async limit(count: number) {
        const sorted = [...allMessages].sort((a, b) => a.created_at.localeCompare(b.created_at));
        if (orders[0]?.ascending === false) sorted.reverse();
        return { data: sorted.slice(0, count), error: null };
      },
    };
    const threadQuery = {
      select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { id: uuid(900), title: "Long thread", pending: null, updated_at: "2026-10-11T00:00:00Z" }, error: null }; },
    };
    const attachmentQuery = {
      select() { return this; }, eq() { return this; }, not() { return this; }, is() { return this; }, lt() { return this; },
      async limit() { return { data: [], error: null }; },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
    };
    const context = {
      kind: "ready", userId: uuid(901), shop: { id: uuid(902), name: "QA" },
      client: { from: (table: string) => table === "assistant_messages" ? messageQuery : table === "assistant_message_attachments" ? attachmentQuery : threadQuery },
    } as unknown as Extract<ShopContext, { kind: "ready" }>;

    const result = await new AssistantConversationRepository(context).load(uuid(900));
    expect(orders).toEqual([
      { field: "created_at", ascending: false },
      { field: "id", ascending: false },
    ]);
    expect(result.messages).toHaveLength(300);
    expect(result.messages[0].text).toBe("Turn 2");
    expect(result.messages.at(-1)?.text).toBe("Turn 301");
  });
});
