import { z } from "zod";
import { shoppingDraftSchema } from "@/lib/assistant/shopping-list";
import { attachmentQuestionMode, type AttachmentUnderstanding } from "@/lib/assistant/attachment-understanding";
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
  const questionMode = attachmentQuestionMode(questionResult.data);
  const files = form.getAll("images");
  const validImages = files.every((file): file is File => file instanceof File && imageTypes.has(file.type));
  if (!validImages || !isImageUploadWithinLimit(files as File[])) {
    return Response.json({ error: "Attach up to three JPG, PNG or WebP images totaling no more than 4 MB." }, { status: 413 });
  }
  const pdfTicketValue = form.get("pdfTicket");
  const pdfFileNameValue = form.get("pdfFileName");
  const attachmentId = z.uuid().safeParse(form.get("attachmentId"));
  const hasPdfTicket = isPdfTicket(pdfTicketValue);
  const hasPdfFileName = typeof pdfFileNameValue === "string";
  if (hasPdfTicket !== hasPdfFileName) return Response.json({ error: "The PDF upload could not be verified." }, { status: 400 });
  if (!attachmentId.success) return Response.json({ error: "The saved private attachment could not be verified." }, { status: 400 });
  const conversationId = z.uuid().safeParse(form.get("conversationId"));
  if (!conversationId.success) return Response.json({ error: "Open a conversation before checking a list." }, { status: 400 });
  const requestKey = readIdempotencyKey(request);
  if (!requestKey) return missingIdempotencyKey();
  const turnKey: string = requestKey;
  const threadId = conversationId.data;
  const { data: attachment, error: attachmentError } = await context.client.from("assistant_message_attachments")
    .select("id,storage_path,file_name,mime_type,file_size,attachment_type,message_id,uploaded_at")
    .eq("id", attachmentId.data).eq("conversation_id", threadId).eq("shop_id", context.shop.id)
    .eq("owner_id", context.userId).maybeSingle();
  if (attachmentError || !attachment || !attachment.uploaded_at) return Response.json({ error: "Upload the attachment completely before asking Vaani to read it." }, { status: 404 });
  if ((attachment.attachment_type === "pdf") !== hasPdfTicket) return Response.json({ error: "The saved attachment type does not match its processing request." }, { status: 400 });
  if (attachment.message_id) {
    const { data: linkedMessage } = await context.client.from("assistant_messages").select("request_key")
      .eq("id", attachment.message_id).eq("conversation_id", threadId).eq("owner_id", context.userId).maybeSingle();
    if (linkedMessage?.request_key !== turnKey) return Response.json({ error: "This attachment is already linked to another conversation message." }, { status: 409 });
  }
  const googleKey = process.env.GEMINI_API_KEY?.trim();
  if (hasPdfTicket && !googleKey) return Response.json({ error: "Gemini is not configured for PDF reasoning." }, { status: 503 });
  const claims = hasPdfTicket && googleKey ? verifyGeminiUploadTicket(pdfTicketValue, googleKey) : null;
  if (hasPdfTicket && (!claims || claims.userId !== context.userId || claims.shopId !== context.shop.id || claims.conversationId !== threadId
    || claims.size !== attachment.file_size
    || !/^files\/[A-Za-z0-9_-]+$/.test(String(pdfFileNameValue)))) {
    return Response.json({ error: "This PDF upload session is invalid or expired." }, { status: 403 });
  }

  const images: VisionImage[] = [];
  const { data: storedFile, error: storedFileError } = await context.client.storage.from("assistant-attachments").download(attachment.storage_path);
  if (storedFileError || !storedFile || storedFile.size !== attachment.file_size) return Response.json({ error: "The private attachment could not be read completely." }, { status: 422 });
  const storedBytes = new Uint8Array(await storedFile.arrayBuffer());
  if (attachment.attachment_type === "image") {
    if (!matchesSignature(attachment.mime_type, storedBytes) || files.length) return Response.json({ error: "The image format could not be verified." }, { status: 422 });
    images.push({ mimeType: attachment.mime_type as VisionImage["mimeType"], bytes: storedBytes });
  } else {
    if (new TextDecoder().decode(storedBytes.subarray(0, 5)) !== "%PDF-") return Response.json({ error: "The saved PDF could not be verified." }, { status: 422 });
    for (const file of files as File[]) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!matchesSignature(file.type, bytes)) return Response.json({ error: "A rendered PDF page did not match its image type." }, { status: 422 });
      images.push({ mimeType: file.type, bytes });
    }
  }
  const conversation = new AssistantConversationRepository(context);
  let reserved;
  try {
    reserved = await conversation.reserve(threadId, turnKey, questionResult.data.trim() || "Review attached file");
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

  if (!attachment.message_id) {
    try { await conversation.attachToUserMessage(threadId, attachment.id, turnKey); }
    catch { return await finish({ state: "failed", title: "Attachment could not be saved", intent: "attachment.reason",
      detail: "The file remains private and no store records were changed.", reply: "I could not link this file to the conversation. Please remove it and upload it again." }, 503); }
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
          // Native PDF understanding preserves document semantics. The page
          // renders remain private and are used only if the configured image
          // fallback is needed after a retryable Gemini failure.
          images: verifiedPdf ? [] : images,
          ...(verifiedPdf ? { pdfUri: verifiedPdf.uri } : {}),
          question: questionResult.data,
          mode: questionMode,
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
      understanding = await fallback.reason(images, questionResult.data, questionMode);
    }

    if (questionMode === "visual-question") {
      const evidence = understanding.answer ?? (understanding.items.length
        ? understanding.items.map((item) => `${item.product}: ${item.quantity == null ? "quantity unclear" : `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`}`).join("; ")
        : "I could not identify a product clearly in the image.");
      return await finish({ state: "preview", title: "Image observation", intent: "attachment.reason",
        detail: "Based only on visible evidence. No shop records were changed.", reply: evidence });
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
    if (fileName && googleKey) await deleteGeminiFile(googleKey, fileName).catch(() => undefined);
  }
}
