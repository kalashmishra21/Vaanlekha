import "server-only";

import { z } from "zod";
import { pendingClarificationSchema, type PendingClarification } from "@/lib/ai/types/tool-call";
import { assistantResponseSchema, type AssistantResponse } from "@/lib/business/assistant-response";
import { conversationReservationError } from "@/lib/assistant/conversation-errors";
import type { ShopContext } from "./context";

type ReadyContext = Extract<ShopContext, { kind: "ready" }>;

const threadSchema = z.object({ id: z.uuid(), title: z.string(), updated_at: z.string() });
const messageSchema = z.object({ id: z.uuid(), role: z.enum(["user", "assistant"]), text: z.string(),
  request_key: z.uuid(), result: z.unknown().nullable(), created_at: z.string() });
const attachmentSchema = z.object({ id: z.uuid(), message_id: z.uuid(), storage_path: z.string(), file_name: z.string(),
  mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), attachment_type: z.enum(["image", "pdf"]), uploaded_at: z.string().nullable() });
const reservedSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("busy") }),
  z.object({ status: z.literal("completed"), result: assistantResponseSchema }),
  z.object({ status: z.literal("reserved"), pending: pendingClarificationSchema.nullable(), pendingRequestKey: z.uuid().nullable() }),
]);

export class AssistantConversationRepository {
  constructor(private readonly context: ReadyContext) {}

  async list() {
    const { data, error } = await this.context.client.from("assistant_conversations")
      .select("id,title,updated_at").eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .order("updated_at", { ascending: false }).limit(50);
    if (error) throw new Error("Conversation history is unavailable.");
    return z.array(threadSchema).parse(data);
  }

  async create(): Promise<string> {
    const { data, error } = await this.context.client.rpc("create_assistant_conversation", { p_shop_id: this.context.shop.id });
    if (error) throw new Error("A new conversation could not be created.");
    return z.uuid().parse(data);
  }

  async load(id: string) {
    await this.cleanupExpiredUnlinkedAttachments();
    // Both reads are independently owner-scoped by RLS. Starting them together
    // removes a Supabase round trip from every initial Assistant load.
    const [{ data: thread, error: threadError }, { data: messages, error }] = await Promise.all([
      this.context.client.from("assistant_conversations")
        .select("id,title,pending,updated_at").eq("id", id).eq("shop_id", this.context.shop.id)
        .eq("owner_id", this.context.userId).maybeSingle(),
      this.context.client.from("assistant_messages")
        .select("id,role,text,result,request_key,created_at").eq("conversation_id", id).eq("shop_id", this.context.shop.id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300),
    ]);
    if (threadError || !thread) throw new Error("Conversation not found in this shop.");
    if (error) throw new Error("Conversation messages are unavailable.");
    const parsedMessages = z.array(messageSchema).parse(messages).reverse();
    const { data: attachmentRows, error: attachmentError } = await this.context.client.from("assistant_message_attachments")
      .select("id,message_id,storage_path,file_name,mime_type,attachment_type,uploaded_at")
      .eq("conversation_id", id).eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .not("message_id", "is", null).not("uploaded_at", "is", null);
    if (attachmentError) throw new Error("Conversation attachments are unavailable.");
    const attachments = z.array(attachmentSchema).parse(attachmentRows);
    const signed = await Promise.all(attachments.map(async (attachment) => {
      const { data, error: signError } = await this.context.client.storage.from("assistant-attachments")
        .createSignedUrl(attachment.storage_path, 600);
      if (signError || !data) throw new Error("A saved attachment could not be opened.");
      return [attachment.message_id, { id: attachment.id, name: attachment.file_name,
        kind: attachment.attachment_type, mimeType: attachment.mime_type, url: data.signedUrl }] as const;
    }));
    const attachmentByMessage = new Map(signed);
    const safeMessages = parsedMessages.map((message) => {
      const parsed = message.result === null ? null : assistantResponseSchema.safeParse(message.result);
      return { ...message, result: parsed?.success ? parsed.data : null, ...(attachmentByMessage.has(message.id) ? { attachment: attachmentByMessage.get(message.id) } : {}) };
    });
    return { id: z.uuid().parse(thread.id), title: z.string().parse(thread.title),
      pending: thread.pending === null ? null : pendingClarificationSchema.parse(thread.pending), messages: safeMessages };
  }

  async rename(id: string, title: string) {
    const { data, error } = await this.context.client.from("assistant_conversations")
      .update({ title }).eq("id", id).eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .select("id").maybeSingle();
    if (error || !data) throw new Error("Conversation could not be renamed.");
  }

  async remove(id: string) {
    const { data: rows, error: attachmentError } = await this.context.client.from("assistant_message_attachments")
      .select("storage_path").eq("conversation_id", id).eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .not("uploaded_at", "is", null);
    if (attachmentError) throw new Error("Conversation files could not be listed for removal.");
    const paths = z.array(z.object({ storage_path: z.string() })).parse(rows).map((row) => row.storage_path);
    if (paths.length) {
      const { error: storageError } = await this.context.client.storage.from("assistant-attachments").remove(paths);
      if (storageError) throw new Error("Conversation files could not be removed; the conversation is still available.");
    }
    const { data, error } = await this.context.client.from("assistant_conversations")
      .delete().eq("id", id).eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .select("id").maybeSingle();
    if (error || !data) throw new Error("Conversation could not be deleted.");
  }

  async reserve(id: string, requestKey: string, text: string) {
    const { data, error } = await this.context.client.rpc("reserve_assistant_turn", {
      p_shop_id: this.context.shop.id, p_conversation_id: id, p_request_key: requestKey, p_text: text,
    });
    if (error) throw conversationReservationError(error.code);
    return reservedSchema.parse(data);
  }

  async getAssistantMessageId(id: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.from("assistant_messages")
      .select("id").eq("conversation_id", id).eq("shop_id", this.context.shop.id)
      .eq("request_key", requestKey).eq("role", "assistant").maybeSingle();
    if (error || !data) throw new Error("Saved assistant message could not be verified.");
    return z.uuid().parse(data.id);
  }

  async getUserMessageId(id: string, requestKey: string): Promise<string> {
    const { data, error } = await this.context.client.from("assistant_messages")
      .select("id").eq("conversation_id", id).eq("shop_id", this.context.shop.id)
      .eq("request_key", requestKey).eq("role", "user").maybeSingle();
    if (error || !data) throw new Error("Saved user message could not be verified.");
    return z.uuid().parse(data.id);
  }

  async attachToUserMessage(id: string, attachmentId: string, requestKey: string): Promise<void> {
    const messageId = await this.getUserMessageId(id, requestKey);
    const { data, error } = await this.context.client.from("assistant_message_attachments")
      .update({ message_id: messageId }).eq("id", attachmentId).eq("conversation_id", id)
      .eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId).is("message_id", null)
      .not("uploaded_at", "is", null).select("id").maybeSingle();
    if (error || !data) throw new Error("The private attachment could not be linked to this message.");
  }

  private async cleanupExpiredUnlinkedAttachments(): Promise<void> {
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.context.client.from("assistant_message_attachments")
      .select("id,storage_path").eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId)
      .is("message_id", null).lt("created_at", expiredAt).limit(100);
    if (error || !data?.length) return;
    const rows = z.array(z.object({ id: z.uuid(), storage_path: z.string() })).parse(data);
    const paths = rows.map((row) => row.storage_path);
    const { error: storageError } = await this.context.client.storage.from("assistant-attachments").remove(paths);
    if (storageError) return;
    await this.context.client.from("assistant_message_attachments").delete()
      .in("id", rows.map((row) => row.id)).eq("shop_id", this.context.shop.id).eq("owner_id", this.context.userId);
  }

  async getSaleDraft(id: string, messageId: string) {
    const { data, error } = await this.context.client.from("assistant_messages")
      .select("result").eq("id", messageId).eq("conversation_id", id).eq("shop_id", this.context.shop.id)
      .eq("owner_id", this.context.userId).eq("role", "assistant").maybeSingle();
    if (error || !data) throw new Error("This shopping-list draft is unavailable. Check the list again.");
    const result = assistantResponseSchema.parse(data.result);
    if (result.state !== "draft" || !result.shoppingList?.canConfirm) throw new Error("This shopping list cannot be confirmed.");
    return result.shoppingList;
  }

  async complete(id: string, requestKey: string, result: AssistantResponse, pending: PendingClarification | null, pendingRequestKey: string | null) {
    // TTS bytes and temporary attachment data are deliberately excluded.
    const { speech: _speech, messageId: _messageId, ...persistable } = result;
    void _speech;
    void _messageId;
    const saved = assistantResponseSchema.omit({ speech: true }).parse(persistable);
    const { error } = await this.context.client.rpc("complete_assistant_turn", {
      p_shop_id: this.context.shop.id, p_conversation_id: id, p_request_key: requestKey,
      p_reply: saved.reply, p_result: saved, p_pending: pending, p_pending_request_key: pendingRequestKey,
    });
    if (error) throw new Error("The conversation result could not be saved. Verify store records before retrying.");
    return this.getAssistantMessageId(id, requestKey);
  }
}
