import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getShopContext } from "@/server/data/context";
import { enforceShopRateLimit } from "@/server/security/rate-limit";

const uploadSchema = z.object({
  conversationId: z.uuid(), fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  size: z.number().int().positive().max(5_000_000),
}).strict();
const idSchema = z.object({ id: z.uuid() }).strict();
const bucketName = "assistant-attachments";

function safeFileName(name: string): string {
  const leaf = name.split(/[\\/]/u).at(-1) ?? "attachment";
  return leaf.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 200) || "attachment";
}

function hasValidSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === "image/png") return bytes.length > 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  if (mimeType === "image/jpeg") return bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (mimeType === "image/webp") return bytes.length > 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
  return mimeType === "application/pdf" && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

async function accessContext() {
  const context = await getShopContext();
  return context.kind === "ready" ? context : null;
}

export async function POST(request: Request) {
  const context = await accessContext();
  if (!context) return Response.json({ error: "Sign in and open your shop before attaching a file." }, { status: 401 });
  const limited = await enforceShopRateLimit(context, "assistant_attachment");
  if (limited) return limited;
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a supported JPG, PNG, WebP or PDF file under 5 MB." }, { status: 400 });
  const input = parsed.data;
  const isPdf = input.mimeType === "application/pdf";
  const { data: conversation, error: conversationError } = await context.client.from("assistant_conversations")
    .select("id").eq("id", input.conversationId).eq("shop_id", context.shop.id).eq("owner_id", context.userId).maybeSingle();
  if (conversationError || !conversation) return Response.json({ error: "This conversation is not available in your shop." }, { status: 404 });

  const id = randomUUID();
  const storagePath = `${context.shop.id}/${input.conversationId}/${context.userId}/${id}`;
  const { error: insertError } = await context.client.from("assistant_message_attachments").insert({
    id, shop_id: context.shop.id, owner_id: context.userId, conversation_id: input.conversationId,
    storage_path: storagePath, file_name: safeFileName(input.fileName), mime_type: input.mimeType,
    file_size: input.size, attachment_type: isPdf ? "pdf" : "image",
  });
  if (insertError) return Response.json({ error: "Private attachment storage is not ready. No file was uploaded." }, { status: 503 });
  const { data, error } = await context.client.storage.from(bucketName).createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data) {
    await context.client.from("assistant_message_attachments").delete().eq("id", id).eq("owner_id", context.userId);
    return Response.json({ error: "A secure upload could not be started. Try again." }, { status: 503 });
  }
  return Response.json({ id, signedUrl: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const context = await accessContext();
  if (!context) return Response.json({ error: "Sign in to verify this upload." }, { status: 401 });
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The upload could not be verified." }, { status: 400 });
  const { data: attachment, error } = await context.client.from("assistant_message_attachments")
    .select("id,storage_path,file_size,mime_type,uploaded_at").eq("id", parsed.data.id)
    .eq("shop_id", context.shop.id).eq("owner_id", context.userId).maybeSingle();
  if (error || !attachment) return Response.json({ error: "This attachment is not available in your shop." }, { status: 404 });
  if (attachment.uploaded_at) return Response.json({ id: attachment.id, uploaded: true });
  const { data: file, error: downloadError } = await context.client.storage.from(bucketName).download(attachment.storage_path);
  if (downloadError || !file || file.size !== attachment.file_size) return Response.json({ error: "The uploaded file is incomplete. Please upload it again." }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasValidSignature(attachment.mime_type, bytes)) return Response.json({ error: "The file contents do not match the selected file type." }, { status: 422 });
  const { error: updateError } = await context.client.from("assistant_message_attachments")
    .update({ uploaded_at: new Date().toISOString() }).eq("id", attachment.id).eq("shop_id", context.shop.id)
    .eq("owner_id", context.userId).is("uploaded_at", null);
  if (updateError) return Response.json({ error: "The uploaded file could not be saved to conversation storage." }, { status: 503 });
  return Response.json({ id: attachment.id, uploaded: true });
}

export async function DELETE(request: Request) {
  const context = await accessContext();
  if (!context) return Response.json({ error: "Sign in to remove this attachment." }, { status: 401 });
  const parsed = idSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The attachment could not be removed." }, { status: 400 });
  const { data: attachment, error } = await context.client.from("assistant_message_attachments")
    .select("id,storage_path").eq("id", parsed.data.id).eq("shop_id", context.shop.id)
    .eq("owner_id", context.userId).is("message_id", null).maybeSingle();
  if (error || !attachment) return Response.json({ error: "This attachment is no longer available." }, { status: 404 });
  const { error: storageError } = await context.client.storage.from(bucketName).remove([attachment.storage_path]);
  if (storageError) return Response.json({ error: "The private file could not be removed." }, { status: 503 });
  const { error: deleteError } = await context.client.from("assistant_message_attachments").delete()
    .eq("id", attachment.id).eq("owner_id", context.userId).is("message_id", null);
  if (deleteError) return Response.json({ error: "The attachment record could not be removed." }, { status: 503 });
  return new Response(null, { status: 204 });
}
