import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AssistantConversationRepository } from "../src/server/data/assistant-conversations";

const userId = "11111111-1111-4111-8111-111111111111";
const shopId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const messageId = "44444444-4444-4444-8444-444444444444";
const attachmentId = "55555555-5555-4555-8555-555555555555";

function makeContext() {
  const message = { id: messageId, role: "user", text: "What is in this image?", result: null,
    request_key: "66666666-6666-4666-8666-666666666666", created_at: "2026-11-07T10:00:00Z" };
  const attachment = { id: attachmentId, message_id: messageId, storage_path: `${shopId}/${conversationId}/${userId}/${attachmentId}`,
    file_name: "shelf.png", mime_type: "image/png", attachment_type: "image", uploaded_at: "2026-11-07T10:00:00Z" };
  const storage = { createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://storage.example/short-lived-read" }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })) };
  const rows: Record<string, unknown[]> = { assistant_messages: [message], assistant_message_attachments: [attachment] };
  const deleted = vi.fn(async () => ({ data: { id: conversationId }, error: null }));
  const client = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const query = {
        deleting: false,
        select: () => query, order: () => query, limit: () => query, not: (key: string, _op: string, value: unknown) => { filters.push([`not:${key}`, value]); return query; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        is: (key: string, value: unknown) => { filters.push([`is:${key}`, value]); return query; },
        lt: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        delete: () => { query.deleting = true; return query; },
        maybeSingle: async () => table === "assistant_conversations"
          ? query.deleting ? deleted() : { data: { id: conversationId, title: "History", pending: null }, error: null }
          : deleted(),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          let data = rows[table] ?? [];
          if (table === "assistant_message_attachments" && filters.some(([key, value]) => key === "is:message_id" && value === null)) data = [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: () => storage },
  };
  return { context: { client, userId, shop: { id: shopId, name: "Test shop" } } as never, storage, deleted, attachment };
}

describe("saved assistant attachment history", () => {
  it("recreates a short-lived private preview URL after conversation reload", async () => {
    const fake = makeContext();
    const loaded = await new AssistantConversationRepository(fake.context).load(conversationId);
    expect(loaded.messages[0]).toMatchObject({ id: messageId, attachment: { id: attachmentId, name: "shelf.png", kind: "image", mimeType: "image/png", url: "https://storage.example/short-lived-read" } });
    expect(fake.storage.createSignedUrl).toHaveBeenCalledWith(fake.attachment.storage_path, 600);
  });

  it("removes private attachment objects before deleting their conversation", async () => {
    const fake = makeContext();
    await new AssistantConversationRepository(fake.context).remove(conversationId);
    expect(fake.storage.remove).toHaveBeenCalledWith([fake.attachment.storage_path]);
    expect(fake.deleted).toHaveBeenCalledTimes(1);
  });
});
