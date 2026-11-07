import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  authorizedConversation: "33333333-3333-4333-8333-333333333333",
  downloadBytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]),
  sign: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  context: undefined as unknown,
}));

function chain(table: string) {
  let selectedId: string | null = null;
  let selectedOwner: string | null = null;
  let selectedConversation: string | null = null;
  let updated: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (key: string, value: string) => { if (key === "id") { selectedId = value; if (Object.keys(updated).length) Object.assign(state.rows.get(value) ?? {}, updated); } if (key === "owner_id") selectedOwner = value; if (key === "conversation_id") selectedConversation = value; return query; },
    is: () => query,
    insert: async (row: Record<string, unknown>) => { state.rows.set(String(row.id), row); return { error: null }; },
    update: (value: Record<string, unknown>) => { updated = value; return query; },
    delete: () => query,
    maybeSingle: async () => {
      if (table === "assistant_conversations") return selectedId === state.authorizedConversation ? { data: { id: selectedId }, error: null } : { data: null, error: null };
      const row = selectedId ? state.rows.get(selectedId) : [...state.rows.values()].find((item) => item.conversation_id === selectedConversation && item.owner_id === selectedOwner);
      if (row && selectedId && Object.keys(updated).length) { Object.assign(row, updated); return { data: { id: selectedId }, error: null }; }
      return { data: row ?? null, error: null };
    },
  };
  return query;
}

const client = {
  from: (table: string) => chain(table),
  storage: { from: () => ({
    createSignedUploadUrl: state.sign,
    download: state.download,
    remove: state.remove,
  }) },
};

vi.mock("@/server/data/context", () => ({ getShopContext: async () => state.context }));
vi.mock("@/server/security/rate-limit", () => ({ enforceShopRateLimit: async () => null }));

import { PATCH, POST } from "../src/app/api/assistant/attachments/route";

const conversationId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  state.rows.clear();
  state.authorizedConversation = conversationId;
  state.sign.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed-test-capability" }, error: null });
  state.download.mockImplementation(async () => ({ data: new Blob([state.downloadBytes]), error: null }));
  state.remove.mockResolvedValue({ data: [], error: null });
  state.context = { kind: "ready", client, userId: "11111111-1111-4111-8111-111111111111",
    shop: { id: "22222222-2222-4222-8222-222222222222", name: "Test Shop" } };
});

describe("private assistant attachment storage", () => {
  it("creates an owner-scoped private upload and verifies the stored image bytes", async () => {
    const response = await POST(new Request("https://app.test/api/assistant/attachments", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, fileName: "shelf.png", mimeType: "image/png", size: state.downloadBytes.length }) }));
    expect(response.status).toBe(200);
    const session = await response.json();
    expect(session.id).toMatch(/[0-9a-f-]{36}/u);
    expect(state.sign).toHaveBeenCalledWith(`22222222-2222-4222-8222-222222222222/${conversationId}/11111111-1111-4111-8111-111111111111/${session.id}`, { upsert: false });
    expect(state.rows.get(session.id)).toMatchObject({ owner_id: "11111111-1111-4111-8111-111111111111", attachment_type: "image" });
    expect(state.rows.get(session.id)?.uploaded_at).toBeUndefined();

    const verified = await PATCH(new Request("https://app.test/api/assistant/attachments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: session.id }) }));
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ id: session.id, uploaded: true });
    expect(state.download).toHaveBeenCalledWith(state.rows.get(session.id)?.storage_path);
    expect(state.rows.get(session.id)?.uploaded_at).toEqual(expect.any(String));
  });

  it("rejects an attachment for a conversation outside the authenticated shop", async () => {
    state.authorizedConversation = "44444444-4444-4444-8444-444444444444";
    const response = await POST(new Request("https://app.test/api/assistant/attachments", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, fileName: "shelf.png", mimeType: "image/png", size: 12 }) }));
    expect(response.status).toBe(404);
    expect(state.sign).not.toHaveBeenCalled();
    expect(state.rows.size).toBe(0);
  });

  it("rejects stored bytes that do not match declared MIME", async () => {
    state.downloadBytes = new Uint8Array([1, 2, 3]);
    const response = await POST(new Request("https://app.test/api/assistant/attachments", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, fileName: "shelf.png", mimeType: "image/png", size: 3 }) }));
    const { id } = await response.json();
    const verified = await PATCH(new Request("https://app.test/api/assistant/attachments", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }));
    expect(verified.status).toBe(422);
    expect(state.rows.get(id)?.uploaded_at).toBeUndefined();
  });
});
