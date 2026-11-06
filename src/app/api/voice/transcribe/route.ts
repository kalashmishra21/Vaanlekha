import { createAIProvider } from "@/lib/ai/provider";
import { isShortWav } from "@/lib/ai/wav";
import { readProviderConfig } from "@/lib/env/config";
import { getShopContext } from "@/server/data/context";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { ProviderRequestError } from "@/lib/ai/provider-http";

export const maxDuration = 60;

export async function POST(request: Request) {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to use voice." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Connect your shop before using voice." }, { status: 409 });
  if (readProviderConfig().AI_PROVIDER !== "gnani") return Response.json({ error: "Real voice is not enabled in mock mode." }, { status: 409 });
  const voiceLimit = await enforceShopRateLimit(context, "gnani_transcribe");
  if (voiceLimit) return voiceLimit;
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return Response.json({ error: "Send a WAV recording." }, { status: 415 });

  let form: FormData;
  try { form = await request.formData(); } catch { return Response.json({ error: "The recording could not be read." }, { status: 400 }); }
  const file = form.get("audio");
  const language = form.get("language");
  if (!(file instanceof File) || file.type !== "audio/wav" || file.size > 1_000_000 || !["hi-IN", "en-IN"].includes(String(language))) {
    return Response.json({ error: "Use a short WAV recording and select Hindi or English." }, { status: 422 });
  }
  const audio = new Uint8Array(await file.arrayBuffer());
  if (!isShortWav(audio)) return Response.json({ error: "The recording format is invalid or longer than 15 seconds." }, { status: 422 });
  try {
    const result = await createAIProvider().transcribe({ audio, mimeType: "audio/wav", languageHint: String(language) });
    return Response.json(result);
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return Response.json(
        { error: error.status === 429 ? "Prisma is busy. Please wait and try again; no store action was taken." : "Transcription is unavailable. No store action was taken." },
        { status: error.status === 429 ? 429 : 503, headers: error.status === 429 ? { "Retry-After": error.retryAfter ?? "2" } : undefined },
      );
    }
    return Response.json({ error: "Transcription is unavailable. No store action was taken." }, { status: 503 });
  }
}
