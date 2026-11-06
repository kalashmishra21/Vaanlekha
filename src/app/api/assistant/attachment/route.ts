import { z } from "zod";
import { parseTextShoppingList } from "@/lib/assistant/parse-text-list";
import { shoppingDraftSchema, type ShoppingItem } from "@/lib/assistant/shopping-list";
import { OpenRouterVisionExtractor, type VisionImage } from "@/lib/ai/vision/openrouter-vision";
import { readProviderConfig } from "@/lib/env/config";
import { getShopContext } from "@/server/data/context";
import { SupabaseBusinessRepository } from "@/server/data/tool-repository";
import { BusinessToolExecutor, describeToolResult } from "@/server/tools/business-executor";
import { executeValidatedToolCall } from "@/server/tools/contracts";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { ProviderRequestError } from "@/lib/ai/provider-http";
import { AssistantConversationRepository } from "@/server/data/assistant-conversations";
import { missingIdempotencyKey, readIdempotencyKey } from "@/server/security/idempotency";
import { isImageUploadWithinLimit } from "@/lib/assistant/attachment-limits";
import type { AssistantResponse } from "@/lib/business/assistant-response";

const textSchema = z.string().max(6000);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const maxDuration = 60;

function matchesSignature(mimeType: string, bytes: Uint8Array): mimeType is VisionImage["mimeType"] {
  if (mimeType === "image/png") return bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  if (mimeType === "image/jpeg") return bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (mimeType === "image/webp") return bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to check store inventory." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect your shop before checking a list." }, { status: 409 });
  const attachmentLimit = await enforceShopRateLimit(context, "assistant_attachment");
  if (attachmentLimit) return attachmentLimit;

  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "Attach a valid image or PDF list." }, { status: 400 }); }
  const textResult = textSchema.safeParse(form.get("extractedText") ?? "");
  if (!textResult.success) return Response.json({ error: "The extracted document is too long." }, { status: 413 });
  const files = form.getAll("images");
  const validImages = files.every((file): file is File => file instanceof File && imageTypes.has(file.type));
  if (!validImages || !isImageUploadWithinLimit(files as File[])) {
    return Response.json({ error: "Attach up to three JPG, PNG or WebP images totaling no more than 4 MB." }, { status: 413 });
  }
  if (!textResult.data.trim() && !files.length) return Response.json({ error: "The attachment contains no readable list." }, { status: 422 });
  const conversationId = z.uuid().safeParse(form.get("conversationId"));
  if (!conversationId.success) return Response.json({ error: "Open a conversation before checking a list." }, { status: 400 });
  const requestKey = readIdempotencyKey(request);
  if (!requestKey) return missingIdempotencyKey();
  const turnKey: string = requestKey;
  const threadId = conversationId.data as string;

  const images: VisionImage[] = [];
  for (const file of files as File[]) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(file.type, bytes)) return Response.json({ error: "The image format does not match its file type." }, { status: 422 });
    images.push({ mimeType: file.type, bytes });
  }
  const visionApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (images.length && !visionApiKey) return Response.json({ error: "Image reading is not configured. Text PDFs can still be checked." }, { status: 503 });
  if (images.length) {
    const visionLimit = await enforceShopRateLimit(context, "openrouter_vision");
    if (visionLimit) return visionLimit;
  }
  const conversation = new AssistantConversationRepository(context);
  try {
    const reserved = await conversation.reserve(threadId, turnKey, "Check a shopping list attachment");
    if (reserved.status === "completed") return Response.json({ ...reserved.result,
      messageId: await conversation.getAssistantMessageId(threadId, turnKey) }, { status: reserved.result.state === "failed" ? 422 : 200 });
    if (reserved.status === "busy") return Response.json({ error: "This conversation is busy. No list or sale was created." }, { status: 409, headers: { "Retry-After": "2" } });
  } catch { return Response.json({ error: "Conversation could not be reserved. No list or sale was created." }, { status: 503 }); }
  async function finish(answer: AssistantResponse, status = 200, headers?: HeadersInit): Promise<Response> {
    let messageId: string;
    try { messageId = await conversation.complete(threadId, turnKey, answer, null, null); }
    catch { return Response.json({ error: "The list result could not be saved to the conversation. No sale was recorded." }, { status: 503 }); }
    return Response.json({ ...answer, messageId }, { status, headers });
  }
  let items: ShoppingItem[] = [];
  try {
    if (textResult.data.trim()) items = parseTextShoppingList(textResult.data);
    if (images.length) {
      const visionConfig = readProviderConfig();
      const vision = new OpenRouterVisionExtractor(visionApiKey as string, visionConfig.OPENROUTER_VISION_MODEL,
        fetch, visionConfig.OPENROUTER_VISION_FALLBACK_MODELS);
      items = [...items, ...await vision.extract(images)];
    }
    const result = await executeValidatedToolCall({ intent: "inventory.checkList", arguments: { items } },
      new BusinessToolExecutor(new SupabaseBusinessRepository(context)));
    if ("clarification" in result) return finish({ state: "failed", title: "List needs clarification", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "The shopping list needs clarification. No list or sale was created." }, 422);
    if (!result.ok) return finish({ state: "failed", title: "List check failed", intent: "inventory.checkList", detail: result.error, reply: result.error }, 422);
    const draft = shoppingDraftSchema.parse((result.data as { draft: unknown }).draft);
    return finish({ state: "draft", intent: "inventory.checkList", ...describeToolResult(result), shoppingList: draft });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return finish({ state: "failed", title: "Image reading unavailable", intent: "inventory.checkList", detail: "No sale was created.",
        reply: error.status === 429 ? "Image reading is busy. Please wait and retry; no list or sale was created." : "Image reading is unavailable. No list or sale was created." }, error.status === 429 ? 429 : 503,
      error.status === 429 ? { "Retry-After": error.retryAfter ?? "2" } : undefined);
    }
    const message = error instanceof Error && /^(Vision model|Vision providers|The vision model|The list repeats)/.test(error.message)
      ? error.message : "The list could not be read safely. Check the file and try again.";
    return finish({ state: "failed", title: "List check failed", intent: "inventory.checkList", detail: "No sale was created.", reply: message }, message.startsWith("Vision providers") ? 503 : 422);
  }
}
