import { assistantResponseSchema } from "../business/assistant-response";

export type AssistantTurnRequest = {
  text: string;
  speak: boolean;
  recent: { role: "user" | "assistant"; text: string }[];
  pending: unknown;
  conversationId?: string;
  idempotencyKey: string;
};

export async function postAssistantTurn(
  input: AssistantTurnRequest,
  fetcher: typeof fetch = fetch,
) {
  if (!input.text.trim()) throw new Error("Enter a message before asking Vaani.");
  const response = await fetcher("/api/assistant/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ text: input.text, speak: input.speak, recent: input.recent, pending: input.pending,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}) }),
  });
  const body: unknown = await response.json().catch(() => null);
  const result = assistantResponseSchema.safeParse(body);
  if (result.success) return result.data;
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    throw new Error(response.status === 401 ? "Sign in again to continue." : body.error.slice(0, 250));
  }
  throw new Error("The result could not be verified. Check store records before retrying.");
}

/** Synchronous guard used by the composer to collapse repeated clicks. */
export class AssistantTurnLock {
  private locked = false;
  acquire(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  release(): void { this.locked = false; }
  get active(): boolean { return this.locked; }
}
