import { createHash } from "node:crypto";
import { z } from "zod";
import { toolCallSchema } from "@/lib/ai/types/tool-call";
import { getShopContext } from "@/server/data/context";
import { SupabaseBusinessRepository } from "@/server/data/tool-repository";
import { BusinessToolExecutor, describeToolResult } from "@/server/tools/business-executor";
import { executeValidatedToolCall } from "@/server/tools/contracts";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { missingIdempotencyKey, readIdempotencyKey } from "@/server/security/idempotency";
import { AssistantConversationRepository } from "@/server/data/assistant-conversations";
import { ConversationRequestConflictError } from "@/lib/assistant/conversation-errors";
import type { AssistantResponse } from "@/lib/business/assistant-response";
import { localizedSaleConfirmation } from "@/lib/assistant/response-language";
import { measuredQuantity } from "@/lib/business/schemas";

const requestSchema = z.object({
  confirmed: z.literal(true),
  items: z.array(z.object({ productId: z.uuid(), quantity: measuredQuantity.max(10000) }).strict()).min(1).max(30),
  paymentMethod: z.enum(["cash", "upi", "card"]),
  conversationId: z.uuid(),
  draftMessageId: z.uuid(),
}).strict();

export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Confirm a valid basket." }, { status: 400 }); }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Review the basket before confirming the sale." }, { status: 422 });
  const requestKey = readIdempotencyKey(request);
  if (!requestKey) return missingIdempotencyKey();
  if (requestKey !== parsed.data.draftMessageId) return Response.json({ error: "This sale must use its saved draft identity." }, { status: 422 });
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in before confirming a sale." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect a shop before confirming a sale." }, { status: 409 });
  const rateLimited = await enforceShopRateLimit(context, "business_action");
  if (rateLimited) return rateLimited;

  const conversation = new AssistantConversationRepository(context);
  let savedDraft;
  try { savedDraft = await conversation.getSaleDraft(parsed.data.conversationId, parsed.data.draftMessageId); }
  catch { return Response.json({ error: "The saved shopping-list draft could not be verified. Check the list again." }, { status: 409 }); }
  const approvedItems = savedDraft.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  if (approvedItems.some((item) => !item.productId) || JSON.stringify(approvedItems) !== JSON.stringify(parsed.data.items)) {
    return Response.json({ error: "The basket differs from the saved draft. Check the list again." }, { status: 409 });
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({ items: parsed.data.items, paymentMethod: parsed.data.paymentMethod })).digest("hex");
  try {
    const reserved = await conversation.reserve(parsed.data.conversationId, requestKey,
      `Confirm saved basket ${parsed.data.draftMessageId}: ${fingerprint}`);
    if (reserved.status === "completed") return Response.json({ ...reserved.result,
      messageId: await conversation.getAssistantMessageId(parsed.data.conversationId, requestKey) },
      { status: reserved.result.state === "failed" ? 409 : 200 });
    if (reserved.status === "busy") return Response.json({ error: "This conversation is busy. No new sale was recorded." },
      { status: 409, headers: { "Retry-After": "2" } });
  } catch (error) {
    if (error instanceof ConversationRequestConflictError) return Response.json({ error: "This saved basket was already confirmed with different details. Check Sales; no additional sale was recorded." }, { status: 409 });
    return Response.json({ error: "Conversation could not be reserved. Check Sales before retrying." }, { status: 503 });
  }

  const call = toolCallSchema.parse({ intent: "sales.recordConfirmedBasket", arguments: {
    items: parsed.data.items.map((item, index) => ({ ...item,
      ...(savedDraft.source === "spoken-sale" ? { expectedUnitPrice: savedDraft.items[index].unitPrice } : {}) })), paymentMethod: parsed.data.paymentMethod,
  } });
  const result = await executeValidatedToolCall(call, new BusinessToolExecutor(new SupabaseBusinessRepository(context), requestKey));
  const description = describeToolResult(result);
  if (result.ok) description.reply = localizedSaleConfirmation(savedDraft.source,
    savedDraft.items[0].productName ?? savedDraft.items[0].requestedName,
    (result.data as { total: number }).total, description.reply);
  const answer: AssistantResponse = { state: result.ok ? "confirmed" : "failed", intent: call.intent,
    ...description, sourceDraftId: parsed.data.draftMessageId };
  let messageId: string;
  try { messageId = await conversation.complete(parsed.data.conversationId, requestKey, answer, null, null); }
  catch { return Response.json({ error: "The sale result could not be saved to the conversation. Check Sales before retrying." }, { status: 503 }); }
  return Response.json({ ...answer, messageId }, { status: result.ok ? 200 : 409 });
}
