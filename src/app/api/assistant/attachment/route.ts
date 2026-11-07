import { z } from "zod";
import { shoppingDraftSchema } from "@/lib/assistant/shopping-list";
import type { AttachmentUnderstanding } from "@/lib/assistant/attachment-understanding";
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
import { GeminiAttachmentExtractor } from "@/server/ai/gemini-attachment";
import { deleteGeminiFile, getGeminiPdfFile, waitForGeminiPdfFile } from "@/server/ai/gemini-files";
import { verifyGeminiUploadTicket } from "@/server/ai/gemini-upload-ticket";
import { canFallbackFromGeminiAttachment } from "@/server/ai/attachment-fallback";

const questionSchema = z.string().max(1000);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const maxDuration = 60;

function matchesSignature(mimeType: string, bytes: Uint8Array): mimeType is VisionImage["mimeType"] {
  if (mimeType === "image/png") return bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  if (mimeType === "image/jpeg") return bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  if (mimeType === "image/webp") return bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
  return false;
}

function isPdfTicket(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 5000;
}

export async function POST(request: Request) {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to check store inventory." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect your shop before checking a list." }, { status: 409 });
  const attachmentLimit = await enforceShopRateLimit(context, "assistant_attachment");
  if (attachmentLimit) return attachmentLimit;

  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "Attach a valid image or PDF list." }, { status: 400 }); }
  const questionResult = questionSchema.safeParse(form.get("question") ?? "");
  if (!questionResult.success) return Response.json({ error: "The attachment question is too long." }, { status: 413 });
  const files = form.getAll("images");
  const validImages = files.every((file): file is File => file instanceof File && imageTypes.has(file.type));
  if (!validImages || !isImageUploadWithinLimit(files as File[])) {
    return Response.json({ error: "Attach up to three JPG, PNG or WebP images totaling no more than 4 MB." }, { status: 413 });
  }
  const pdfTicketValue = form.get("pdfTicket");
  const pdfFileNameValue = form.get("pdfFileName");
  const hasPdfTicket = isPdfTicket(pdfTicketValue);
  const hasPdfFileName = typeof pdfFileNameValue === "string";
  if (hasPdfTicket !== hasPdfFileName) return Response.json({ error: "The PDF upload could not be verified." }, { status: 400 });
  if (!files.length && !hasPdfTicket) return Response.json({ error: "Attach a readable image or PDF shopping list." }, { status: 422 });
  const conversationId = z.uuid().safeParse(form.get("conversationId"));
  if (!conversationId.success) return Response.json({ error: "Open a conversation before checking a list." }, { status: 400 });
  const requestKey = readIdempotencyKey(request);
  if (!requestKey) return missingIdempotencyKey();
  const turnKey: string = requestKey;
  const threadId = conversationId.data;
  const googleKey = process.env.GEMINI_API_KEY?.trim();
  if (hasPdfTicket && !googleKey) return Response.json({ error: "Gemini is not configured for PDF reasoning." }, { status: 503 });
  const claims = hasPdfTicket && googleKey ? verifyGeminiUploadTicket(pdfTicketValue, googleKey) : null;
  if (hasPdfTicket && (!claims || claims.userId !== context.userId || claims.shopId !== context.shop.id || claims.conversationId !== threadId
    || !/^files\/[A-Za-z0-9_-]+$/.test(String(pdfFileNameValue)))) {
    return Response.json({ error: "This PDF upload session is invalid or expired." }, { status: 403 });
  }

  const images: VisionImage[] = [];
  for (const file of files as File[]) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!matchesSignature(file.type, bytes)) return Response.json({ error: "The image format does not match its file type." }, { status: 422 });
    images.push({ mimeType: file.type, bytes });
  }
  const conversation = new AssistantConversationRepository(context);
  let reserved;
  try {
    reserved = await conversation.reserve(threadId, turnKey, "Check a shopping list attachment");
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

  const fileName = hasPdfTicket ? String(pdfFileNameValue) : null;
  let verifiedPdf: Awaited<ReturnType<typeof getGeminiPdfFile>> | null = null;
  try {
    if (fileName && claims && googleKey) {
      const uploadedPdf = await getGeminiPdfFile(googleKey, fileName);
      if (uploadedPdf.displayName !== claims.displayName || uploadedPdf.mimeType !== "application/pdf" || Number(uploadedPdf.sizeBytes) !== claims.size) {
        return await finish({ state: "failed", title: "PDF could not be verified", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "The uploaded PDF could not be verified. No list or sale was created." }, 422);
      }
      verifiedPdf = uploadedPdf;
      if (uploadedPdf.state === "FAILED") return await finish({ state: "failed", title: "PDF could not be read", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "Gemini could not read this PDF. No list or sale was created." }, 422);
      const readyPdf = await waitForGeminiPdfFile(googleKey, fileName);
      if (readyPdf.displayName !== claims.displayName || readyPdf.mimeType !== "application/pdf" || Number(readyPdf.sizeBytes) !== claims.size) {
        return await finish({ state: "failed", title: "PDF could not be verified", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "The uploaded PDF could not be verified. No list or sale was created." }, 422);
      }
      verifiedPdf = readyPdf;
    }

    let understanding: AttachmentUnderstanding;
    let geminiFailure: unknown = null;
    if (googleKey) {
      try {
        const config = readProviderConfig();
        understanding = await new GeminiAttachmentExtractor(googleKey, config.GEMINI_MODEL).extract({
          images,
          ...(verifiedPdf ? { pdfUri: verifiedPdf.uri } : {}),
          question: questionResult.data,
        });
      } catch (error) {
        if (!canFallbackFromGeminiAttachment(error)) throw error;
        geminiFailure = error;
        understanding = { items: [] };
      }
    } else {
      geminiFailure = new Error("Gemini is not configured.");
      understanding = { items: [] };
    }

    if (geminiFailure) {
      const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
      if (!openRouterKey || images.length === 0) {
        if (geminiFailure instanceof ProviderRequestError) throw geminiFailure;
        if (!googleKey) throw new Error("Gemini is not configured for document reasoning.");
        throw new Error("Gemini could not read this document safely. No list or sale was created.");
      }
      const visionLimit = await enforceShopRateLimit(context, "openrouter_vision");
      if (visionLimit) return await finish({ state: "failed", title: "Image reading busy", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "Gemini is temporarily unavailable and the image fallback is busy. Please wait and retry." }, 429, { "Retry-After": visionLimit.headers.get("Retry-After") ?? "2" });
      const visionConfig = readProviderConfig();
      const fallback = new OpenRouterVisionExtractor(openRouterKey, visionConfig.OPENROUTER_VISION_MODEL,
        fetch, visionConfig.OPENROUTER_VISION_FALLBACK_MODELS);
      understanding = await fallback.reason(images, questionResult.data);
    }

    if (understanding.items.length === 0) {
      if (!understanding.answer) return await finish({ state: "failed", title: "Document needs clarification", intent: "attachment.reason",
        detail: "No list or sale was created.", reply: "I could not read a clear list or answer from this document. Try a sharper image or ask about a specific part." }, 422);
      return await finish({ state: "preview", title: "Document summary", intent: "attachment.reason",
        detail: "Based on the attached document. No shop records were changed.", reply: understanding.answer });
    }

    const result = await executeValidatedToolCall({ intent: "inventory.checkList", arguments: { items: understanding.items } },
      new BusinessToolExecutor(new SupabaseBusinessRepository(context)));
    if ("clarification" in result) return await finish({ state: "failed", title: "List needs clarification", intent: "inventory.checkList", detail: "No list or sale was created.", reply: "The shopping list needs clarification. No list or sale was created." }, 422);
    if (!result.ok) return await finish({ state: "failed", title: "List check failed", intent: "inventory.checkList", detail: result.error, reply: result.error }, 422);
    const draft = shoppingDraftSchema.parse((result.data as { draft: unknown }).draft);
    const description = describeToolResult(result);
    return await finish({ state: "draft", intent: "inventory.checkList", ...description,
      reply: understanding.answer ?? description.reply, shoppingList: draft });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      const status = error.status === 429 ? 429 : 503;
      return await finish({ state: "failed", title: "Document reading unavailable", intent: "inventory.checkList", detail: "No list or sale was created.",
        reply: error.status === 429 ? "Document reading is busy. Please wait and retry; no list or sale was created." : "Document reading is unavailable. No list or sale was created." }, status,
      status === 429 ? { "Retry-After": error.retryAfter ?? "2" } : undefined);
    }
    const message = error instanceof Error && error.message === "Gemini is not configured for document reasoning."
      ? error.message : "The list could not be read safely. Check the file and try again. No sale was created.";
    return await finish({ state: "failed", title: "List check failed", intent: "inventory.checkList", detail: "No sale was created.", reply: message }, message.includes("not configured") ? 503 : 422);
  } finally {
    if (fileName && googleKey && verifiedPdf) await deleteGeminiFile(googleKey, fileName).catch(() => undefined);
  }
}
