import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getShopContext } from "@/server/data/context";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { createGeminiUploadTicket, verifyGeminiUploadTicket } from "@/server/ai/gemini-upload-ticket";
import { deleteGeminiFile, getGeminiPdfFile, startGeminiPdfUpload } from "@/server/ai/gemini-files";

const startSchema = z.object({
  size: z.number().int().positive().max(5_000_000),
  conversationId: z.uuid(),
}).strict();
const cleanupSchema = z.object({ ticket: z.string().min(1).max(5000), fileName: z.string().regex(/^files\/[A-Za-z0-9_-]+$/) }).strict();

export const maxDuration = 30;

function unavailable() {
  return Response.json({ error: "PDF reasoning is temporarily unavailable. No store data was changed." }, { status: 503 });
}

export async function POST(request: Request) {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to check a PDF." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect your shop before checking a PDF." }, { status: 409 });
  const limited = await enforceShopRateLimit(context, "assistant_attachment");
  if (limited) return limited;
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return unavailable();
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Choose a valid PDF to check." }, { status: 400 }); }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Choose a PDF under 5 MB and an open conversation." }, { status: 400 });
  const { data: ownedThread, error: threadError } = await context.client.from("assistant_conversations")
    .select("id").eq("id", parsed.data.conversationId).eq("shop_id", context.shop.id).eq("owner_id", context.userId).maybeSingle();
  if (threadError || !ownedThread) return Response.json({ error: "Open an available conversation before checking a PDF." }, { status: 404 });

  const displayName = `vaanlekha-${randomUUID()}.pdf`;
  try {
    const uploadUrl = await startGeminiPdfUpload({ apiKey: key, size: parsed.data.size, displayName });
    const ticket = createGeminiUploadTicket({
      userId: context.userId,
      shopId: context.shop.id,
      conversationId: parsed.data.conversationId,
      size: parsed.data.size,
      displayName,
      uploadUrl,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }, key);
    return Response.json({ ticket, chunkSize: 1_048_576 }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return unavailable();
  }
}

export async function DELETE(request: Request) {
  const context = await getShopContext();
  if (context.kind !== "ready") return Response.json({ error: "Sign in to clean up this temporary PDF." }, { status: 401 });
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return unavailable();
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Temporary PDF could not be verified." }, { status: 400 }); }
  const parsed = cleanupSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Temporary PDF could not be verified." }, { status: 400 });
  const claims = verifyGeminiUploadTicket(parsed.data.ticket, key);
  if (!claims || claims.userId !== context.userId || claims.shopId !== context.shop.id) {
    return Response.json({ error: "Temporary PDF could not be verified." }, { status: 403 });
  }
  try {
    const file = await getGeminiPdfFile(key, parsed.data.fileName);
    if (file.displayName !== claims.displayName || file.mimeType !== "application/pdf" || Number(file.sizeBytes) !== claims.size) {
      return Response.json({ error: "Temporary PDF could not be verified." }, { status: 403 });
    }
    await deleteGeminiFile(key, parsed.data.fileName);
    return new Response(null, { status: 204 });
  } catch {
    return unavailable();
  }
}
