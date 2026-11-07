import "server-only";

import { ProviderRequestError } from "@/lib/ai/provider-http";
import { GeminiAttachmentOutputError } from "@/server/ai/gemini-attachment";

const transientGeminiStatuses = new Set([408, 429, 500, 502, 503, 504]);

export function canFallbackFromGeminiAttachment(error: unknown): boolean {
  return error instanceof GeminiAttachmentOutputError
    || error instanceof ProviderRequestError && error.provider === "Gemini" && transientGeminiStatuses.has(error.status);
}

export async function extractWithGeminiFallback<T>(primary: () => Promise<T>, fallback?: () => Promise<T>): Promise<T> {
  try { return await primary(); }
  catch (error) {
    if (!fallback || !canFallbackFromGeminiAttachment(error)) throw error;
    return fallback();
  }
}
