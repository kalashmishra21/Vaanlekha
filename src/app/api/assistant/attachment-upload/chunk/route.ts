import { z } from "zod";
import { getShopContext } from "@/server/data/context";
import { verifyGeminiUploadTicket } from "@/server/ai/gemini-upload-ticket";
import { deleteGeminiFile, forwardGeminiPdfChunk } from "@/server/ai/gemini-files";

export const maxDuration = 30;

export async function POST(request: Request) {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to upload this PDF." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect your shop before uploading a PDF." }, { status: 409 });
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return Response.json({ error: "PDF reasoning is not configured." }, { status: 503 });

  const match = /^Bearer ([A-Za-z0-9_.-]{1,5000})$/.exec(request.headers.get("authorization") ?? "");
  const claims = match ? verifyGeminiUploadTicket(match[1], key) : null;
  if (!claims || claims.userId !== context.userId || claims.shopId !== context.shop.id) {
    return Response.json({ error: "This PDF upload session is invalid or expired." }, { status: 403 });
  }
  const offsetHeader = request.headers.get("x-upload-offset");
  const offset = z.coerce.number().int().min(0).max(claims.size).safeParse(offsetHeader);
  if (!offsetHeader || !offset.success || request.headers.get("content-type") !== "application/octet-stream") {
    return Response.json({ error: "The PDF upload chunk is invalid." }, { status: 400 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 1_048_576) return Response.json({ error: "The PDF upload chunk is too large." }, { status: 413 });
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await request.arrayBuffer()); }
  catch { return Response.json({ error: "The PDF upload chunk could not be read." }, { status: 400 }); }
  if (bytes.byteLength > 1_048_576 || offset.data + bytes.byteLength > claims.size) {
    return Response.json({ error: "The PDF upload chunk is too large." }, { status: 413 });
  }
  if (offset.data === 0 && new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    return Response.json({ error: "The uploaded file is not a valid PDF." }, { status: 422 });
  }

  try {
    const uploaded = await forwardGeminiPdfChunk({ uploadUrl: claims.uploadUrl, offset: offset.data, bytes, totalSize: claims.size });
    if (uploaded.file) {
      if (uploaded.file.displayName !== claims.displayName || uploaded.file.mimeType !== "application/pdf" || Number(uploaded.file.sizeBytes) !== claims.size) {
        await deleteGeminiFile(key, uploaded.file.name).catch(() => undefined);
        return Response.json({ error: "Gemini returned an unexpected PDF file." }, { status: 502 });
      }
      return Response.json({ nextOffset: uploaded.nextOffset, fileName: uploaded.file.name }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ nextOffset: uploaded.nextOffset }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message === "The PDF upload is out of order. Start it again."
      ? error.message : "The PDF could not be uploaded safely. Start again; no store data was changed.";
    return Response.json({ error: message }, { status: message.startsWith("The PDF upload is out of order") ? 409 : 502 });
  }
}
