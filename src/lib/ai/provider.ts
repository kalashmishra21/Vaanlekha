import { readProviderConfig } from "../env/config";
import { MockAIProvider } from "./providers/mock";
import { GnaniVoiceProvider } from "./providers/gnani-voice";
import { OpenRouterReasoner } from "./reasoners/openrouter";
import { GeminiReasoner } from "./reasoners/gemini";
import { ProviderRequestError } from "./provider-http";
import type { AIProvider } from "./types/provider";

const retryableGeminiStatus = new Set([408, 429, 500, 502, 503, 504]);

function canFallback(error: unknown): error is ProviderRequestError {
  return error instanceof ProviderRequestError
    && error.provider === "Gemini"
    && error.source === "provider"
    && retryableGeminiStatus.has(error.status);
}

export function createAIProvider(
  environment: Record<string, string | undefined> = process.env,
  beforeReasonerRequest?: () => Promise<void>,
): AIProvider {
  const config = readProviderConfig(environment);
  const gnaniKey = environment.GNANI_API_KEY?.trim();
  if (config.AI_PROVIDER === "gnani" && !gnaniKey && environment.NODE_ENV !== "production") {
    throw new Error("GNANI_API_KEY is required when AI_PROVIDER=gnani.");
  }
  const voice: AIProvider = config.AI_PROVIDER === "mock" ? new MockAIProvider()
    : gnaniKey ? new GnaniVoiceProvider(gnaniKey)
      : {
        reason: (input) => new MockAIProvider().reason(input),
        transcribe: async () => { throw new Error("GNANI_API_KEY is required for speech recognition."); },
        synthesize: async () => { throw new Error("GNANI_API_KEY is required for speech synthesis."); },
      };
  if (config.AI_REASONER === "mock") return voice;
  const openRouterKey = environment.OPENROUTER_API_KEY?.trim();
  const openRouter = openRouterKey
    ? new OpenRouterReasoner(openRouterKey, config.OPENROUTER_MODEL, fetch, undefined, beforeReasonerRequest)
    : null;
  const geminiKey = environment.GEMINI_API_KEY?.trim();
  if (!geminiKey) throw new Error("GEMINI_API_KEY is required when AI_REASONER=gemini.");
  const gemini = new GeminiReasoner(geminiKey, config.GEMINI_MODEL, fetch, undefined, beforeReasonerRequest);
  return {
    transcribe: (input) => voice.transcribe(input),
    reason: async (input) => {
      try { return await gemini.reason(input); }
      catch (error) {
        // Only retryable Gemini transport/provider failures may use the
        // secondary provider. Invalid model output and local/shop limits fail
        // closed before any business tool executes.
        if (!canFallback(error) || !openRouter) throw error;
        if (environment.AI_REASONER_TRACE === "1") console.info("Reasoner fallback", { from: "Gemini", to: "OpenRouter", cause: error.status });
        return openRouter.reason(input);
      }
    },
    synthesize: (text) => voice.synthesize(text),
  };
}
