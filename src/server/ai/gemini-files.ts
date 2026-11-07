import "server-only";

import { z } from "zod";

const endpoint = "https://generativelanguage.googleapis.com";
const fileSchema = z.object({
  name: z.string().regex(/^files\/[A-Za-z0-9_-]+$/),
  uri: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "generativelanguage.googleapis.com";
  }),
  mimeType: z.string(),
  sizeBytes: z.union([z.string(), z.number()]),
  displayName: z.string(),
  state: z.enum(["PROCESSING", "ACTIVE", "FAILED"]).optional(),
}).passthrough();

export type GeminiPdfFile = z.infer<typeof fileSchema>;

export async function startGeminiPdfUpload(input: {
  apiKey: string; size: number; displayName: string; request?: typeof fetch;
}): Promise<string> {
  const request = input.request ?? fetch;
  const response = await request(`${endpoint}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": input.apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.size),
      "X-Goog-Upload-Header-Content-Type": "application/pdf",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: input.displayName } }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Gemini file upload could not be started.");
  const uploadUrl = response.headers.get("x-goog-upload-url") ?? response.headers.get("location");
  if (!uploadUrl) throw new Error("Gemini did not return a resumable upload session.");
  const parsed = z.url().safeParse(uploadUrl);
  if (!parsed.success) throw new Error("Gemini returned an invalid upload session.");
  const url = new URL(parsed.data);
  if (url.protocol !== "https:" || url.hostname !== "generativelanguage.googleapis.com" || !url.pathname.startsWith("/upload/")) {
    throw new Error("Gemini returned an invalid upload session.");
  }
  return url.toString();
}

export async function forwardGeminiPdfChunk(input: {
  uploadUrl: string; offset: number; bytes: Uint8Array; totalSize: number; request?: typeof fetch;
}): Promise<{ nextOffset: number; file: GeminiPdfFile | null }> {
  const request = input.request ?? fetch;
  const nextOffset = input.offset + input.bytes.byteLength;
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > 1_048_576 || nextOffset > input.totalSize) {
    throw new Error("The PDF upload chunk is invalid.");
  }
  const final = nextOffset === input.totalSize;
  const response = await request(input.uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": String(input.offset),
      "X-Goog-Upload-Command": final ? "upload, finalize" : "upload",
      "Content-Type": "application/pdf",
    },
    body: input.bytes as BodyInit,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 409 ? "The PDF upload is out of order. Start it again." : "Gemini could not receive this PDF chunk.");
  if (!final) return { nextOffset, file: null };
  let raw: unknown;
  try { raw = await response.json(); } catch { throw new Error("Gemini did not finish the PDF upload."); }
  const parsed = z.object({ file: fileSchema }).safeParse(raw);
  if (!parsed.success) throw new Error("Gemini returned an invalid uploaded-file record.");
  return { nextOffset, file: parsed.data.file };
}

export async function getGeminiPdfFile(apiKey: string, name: string, request: typeof fetch = fetch): Promise<GeminiPdfFile> {
  const safeName = z.string().regex(/^files\/[A-Za-z0-9_-]+$/).parse(name);
  const response = await request(`${endpoint}/v1beta/${safeName}`, {
    headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(12_000), cache: "no-store",
  });
  if (!response.ok) throw new Error("The temporary PDF is unavailable.");
  const file = fileSchema.parse(await response.json());
  if (file.name !== safeName) throw new Error("The temporary PDF could not be verified.");
  return file;
}

export async function waitForGeminiPdfFile(apiKey: string, name: string, request: typeof fetch = fetch): Promise<GeminiPdfFile> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const file = await getGeminiPdfFile(apiKey, name, request);
    if (file.state === "FAILED") throw new Error("The temporary PDF could not be processed.");
    if (file.state !== "PROCESSING") return file;
    if (attempt < 4) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("The temporary PDF is still being prepared. Try again shortly.");
}

export async function deleteGeminiFile(apiKey: string, name: string, request: typeof fetch = fetch): Promise<void> {
  const safeName = z.string().regex(/^files\/[A-Za-z0-9_-]+$/).parse(name);
  const response = await request(`${endpoint}/v1beta/${safeName}`, {
    method: "DELETE", headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  if (!response.ok && response.status !== 404) throw new Error("The temporary Gemini file could not be deleted.");
}
