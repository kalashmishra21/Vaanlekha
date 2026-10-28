import { z } from "zod";
import { createAIProvider } from "@/lib/ai/provider";
import { pendingClarificationSchema, reasoningResultSchema, recentTurnSchema } from "@/lib/ai/types/tool-call";
import { shoppingDraftSchema } from "@/lib/assistant/shopping-list";
import { localizeClarification, localizeTrustedReply } from "@/lib/assistant/response-language";
import { readProviderConfig } from "@/lib/env/config";
import { describeMockTurn } from "@/features/assistant/mock-turn";
import { getShopContext } from "@/server/data/context";
import { SupabaseBusinessRepository } from "@/server/data/tool-repository";
import { AssistantConversationRepository } from "@/server/data/assistant-conversations";
import { ConversationRequestConflictError } from "@/lib/assistant/conversation-errors";
import { BusinessToolExecutor, describeToolResult } from "@/server/tools/business-executor";
import { executeValidatedToolCall } from "@/server/tools/contracts";
import { readIdempotencyKey, missingIdempotencyKey } from "@/server/security/idempotency";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { ProviderRequestError, retryAfterSeconds } from "@/lib/ai/provider-http";
import { isClarificationCancel, shouldContinuePending } from "@/lib/assistant/merchant-language";
import type { AssistantResponse } from "@/lib/business/assistant-response";
import type { PendingClarification } from "@/lib/ai/types/tool-call";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  speak: z.boolean().default(false),
  recent: z.array(recentTurnSchema).max(6).default([]),
  pending: pendingClarificationSchema.nullable().optional(),
  conversationId: z.uuid().optional(),
}).strict();

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Enter a valid request." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Enter a request between 1 and 500 characters." }, { status: 400 });
  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return missingIdempotencyKey();
  const turnIdempotencyKey: string = idempotencyKey;
  const conversationId = parsed.data.conversationId;

  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to use trusted store tools." }, { status: 401 });
  if (context.kind === "unavailable") return Response.json({ error: "Store data is temporarily unavailable. Nothing was changed." }, { status: 503 });

  let config;
  try { config = readProviderConfig(); } catch {
    return Response.json({ error: "The AI provider configuration is invalid. Nothing was changed." }, { status: 503 });
  }
  if (context.kind === "setup" && (config.AI_PROVIDER !== "mock" || config.AI_REASONER !== "mock")) {
    return Response.json({ error: "Live AI requests require a signed-in shop and distributed request protection." }, { status: 503 });
  }
  const assistantLimit = await enforceShopRateLimit(context, "assistant_turn");
  if (assistantLimit) return assistantLimit;
  if (parsed.data.speak && config.AI_PROVIDER === "gnani") {
    const speechLimit = await enforceShopRateLimit(context, "assistant_speech");
    if (speechLimit) return speechLimit;
  }

  const repository = context.kind === "ready" ? new SupabaseBusinessRepository(context) : null;
  const conversations = context.kind === "ready" ? new AssistantConversationRepository(context) : null;
  if (conversations && !conversationId) return Response.json({ error: "Open a conversation before sending a store request." }, { status: 400 });
  let savedPending: PendingClarification | null = null;
  let savedRequestKey: string | null = null;
  if (conversations && conversationId) {
    try {
      const reservation = await conversations.reserve(conversationId, idempotencyKey, parsed.data.text);
      if (reservation.status === "completed") return Response.json({ ...reservation.result,
        messageId: await conversations.getAssistantMessageId(conversationId, turnIdempotencyKey) }, { status: reservation.result.state === "failed" ? 409 : 200 });
      if (reservation.status === "busy") return Response.json({ error: "This conversation is processing another request. Try again shortly; nothing new was changed." }, { status: 409, headers: { "Retry-After": "2" } });
      savedPending = reservation.pending;
      savedRequestKey = reservation.pendingRequestKey;
    } catch (error) {
      if (error instanceof ConversationRequestConflictError) return Response.json({ error: "This request key was already used for another message. Check the conversation before retrying; no additional action was taken." }, { status: 409 });
      return Response.json({ error: "Conversation is unavailable. Verify store records before retrying." }, { status: 503 });
    }
  }
  // The authenticated thread, never the browser body, owns follow-up state.
  const continuing = savedPending !== null && shouldContinuePending(savedPending, parsed.data.text);
  const pending = conversations ? continuing ? savedPending : null : parsed.data.pending ?? null;
  const requestKey = continuing && savedRequestKey ? savedRequestKey : idempotencyKey;
  async function finish(answer: AssistantResponse, status = 200, nextPending: PendingClarification | null = null, nextRequestKey: string | null = null): Promise<Response> {
    let messageId: string | undefined;
    if (conversations && conversationId) {
      try { messageId = await conversations.complete(conversationId, turnIdempotencyKey, answer, nextPending, nextRequestKey); }
      catch { return Response.json({ error: "The store result could not be saved to this conversation. Verify store records before retrying." }, { status: 503 }); }
    }
    return Response.json({ ...answer, ...(messageId ? { messageId } : {}) }, { status });
  }
  if (pending && isClarificationCancel(parsed.data.text)) {
    return finish({ state: "unsupported", title: "Request cancelled", intent: "clarification.cancel",
      detail: "No store action was taken.", reply: "Cancelled. Nothing was saved or changed." });
  }

  let provider;
  try { provider = createAIProvider(process.env, async () => {
    const limit = await enforceShopRateLimit(context, "openrouter_reasoner");
    if (limit) throw new ProviderRequestError("OpenRouter", limit.status, limit.headers.get("Retry-After"));
  }); } catch {
    return finish({ state: "failed", title: "AI provider unavailable", intent: "assistant.reason",
      detail: "The selected provider is not configured.", reply: "The selected AI provider is not configured. Nothing was changed." }, 503, pending, continuing ? savedRequestKey : null);
  }
  let reasoning;
  try { reasoning = reasoningResultSchema.parse(await provider.reason({ text: parsed.data.text, recent: parsed.data.recent, pending })); }
  catch (error) {
    if (error instanceof ProviderRequestError) {
      const response = await finish({ state: "failed", title: "Reasoner unavailable", intent: "assistant.reason",
        detail: error.status === 429 ? "The AI provider is rate limited." : "The AI provider is unavailable.",
        reply: error.status === 429 ? "The AI service is busy. Please wait and try again; nothing was changed." : "The AI service is temporarily unavailable. Nothing was changed." },
        error.status === 429 ? 429 : 503, pending, continuing ? savedRequestKey : null);
      const retryAfter = error.status === 429 ? retryAfterSeconds(error.retryAfter) : null;
      if (retryAfter !== null) response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    console.warn("Assistant reasoning rejected:", error instanceof Error && /^OpenRouter /.test(error.message) ? error.message : error instanceof Error ? error.name : "UnknownError");
    return finish({ state: "failed", title: "Reasoning failed", intent: "assistant.reason", detail: "No action was taken.",
      reply: "The request could not be safely interpreted. Nothing was changed." }, 503, pending, continuing ? savedRequestKey : null);
  }
  const preview = describeMockTurn(reasoning);
  if (reasoning.kind === "clarify") {
    return finish({ state: "clarify", title: "One detail needed", intent: reasoning.intent ?? "assistant.clarification",
      detail: "No store action has been taken.", reply: localizeClarification(parsed.data.text, reasoning.pending, reasoning.question), ...(reasoning.pending ? { pending: reasoning.pending } : {}) },
    200, reasoning.pending ?? null, reasoning.pending ? requestKey : null);
  }
  if (reasoning.kind === "unsupported") return finish({ state: "unsupported", ...preview });
  if (context.kind === "setup" || context.kind === "no-shop") return finish({ state: "preview", ...preview });

  if (!repository) return Response.json({ error: "Store data is temporarily unavailable. Nothing was changed." }, { status: 503 });
  const executor = new BusinessToolExecutor(repository, requestKey);
  const result = await executeValidatedToolCall(reasoning.tool, executor);
  if ("clarification" in result) {
    return finish({ state: "clarify", title: "One detail needed", intent: reasoning.tool.intent,
      detail: "No store action has been taken.", reply: localizeClarification(parsed.data.text, result.clarification.pending, result.clarification.question), pending: result.clarification.pending },
    200, result.clarification.pending, requestKey);
  }
  const description = describeToolResult(result);
  if (result.ok) description.reply = localizeTrustedReply(parsed.data.text, result.data, description.reply);
  const shoppingList = result.ok && (reasoning.tool.intent === "inventory.checkList" || reasoning.tool.intent === "sales.prepareSpoken")
    ? shoppingDraftSchema.parse((result.data as { draft: unknown }).draft) : undefined;
  const answer: AssistantResponse = { state: result.ok ? shoppingList ? "draft" : "confirmed" : "failed", intent: reasoning.tool.intent, ...description, shoppingList };

  const persisted = await finish(answer, result.ok ? 200 : 409);
  if (!persisted.ok && persisted.status === 503) return persisted;
  const persistedAnswer = await persisted.json() as AssistantResponse;

  // Business confirmation is formed from the trusted result before speech is
  // requested. A TTS failure cannot turn a failed tool into a success claim.
  if (parsed.data.speak && config.AI_PROVIDER === "gnani") {
    try {
      const speech = await provider.synthesize(answer.reply);
      if (speech.kind === "audio") {
        return Response.json({ ...persistedAnswer, speech: { mimeType: speech.mimeType, data: Buffer.from(speech.bytes).toString("base64") } },
          { status: result.ok ? 200 : 409 });
      }
    } catch {
      return Response.json({ ...persistedAnswer, speechUnavailable: true }, { status: result.ok ? 200 : 409 });
    }
  }
  return Response.json(persistedAnswer, { status: result.ok ? 200 : 409 });
}
