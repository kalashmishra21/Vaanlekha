import { readProviderConfig } from "../env/config";
import { MockAIProvider } from "./providers/mock";
import { GnaniVoiceProvider } from "./providers/gnani-voice";
import { OpenRouterReasoner } from "./reasoners/openrouter";
import { GeminiReasoner } from "./reasoners/gemini";
import { ProviderRequestError } from "./provider-http";
import type { AIProvider } from "./types/provider";

export function createAIProvider(
  environment: Record<string, string | undefined> = process.env,
  beforeReasonerRequest?: () => Promise<void>,
): AIProvider {
  const config = readProviderConfig(environment);
  const voice = config.AI_PROVIDER === "mock" ? new MockAIProvider() : (() => {
    if (!process.env.GNANI_API_KEY?.trim()) throw new Error("GNANI_API_KEY is required when AI_PROVIDER=gnani.");
    return new GnaniVoiceProvider(process.env.GNANI_API_KEY);
  })();
  if (config.AI_REASONER === "mock") return voice;
  const openRouterKey = environment.OPENROUTER_API_KEY?.trim();
  if (!openRouterKey) throw new Error("OPENROUTER_API_KEY is required for live reasoning and fallback.");
  const openRouter = new OpenRouterReasoner(openRouterKey, config.OPENROUTER_MODEL,
    fetch, undefined, beforeReasonerRequest);
  let reason: AIProvider["reason"] = (input) => openRouter.reason(input);
  if (config.AI_REASONER === "gemini") {
    const geminiKey = environment.GEMINI_API_KEY?.trim();
    if (!geminiKey) throw new Error("GEMINI_API_KEY is required when AI_REASONER=gemini.");
    const gemini = new GeminiReasoner(geminiKey, config.GEMINI_MODEL, fetch, undefined, beforeReasonerRequest);
    reason = async (input) => {
      try { return await gemini.reason(input); }
      catch (error) {
        // The shop's own rate limit is authoritative. A provider quota error can use the fallback.
        if (error instanceof ProviderRequestError && error.source === "shop") throw error;
        if (environment.AI_REASONER_TRACE === "1") console.info("Reasoner fallback", { from: "Gemini", to: "OpenRouter", cause: error instanceof ProviderRequestError ? error.status : error instanceof Error ? error.name : "unknown" });
        return openRouter.reason(input);
      }
    };
  }
  return {
    transcribe: (input) => voice.transcribe(input),
    reason,
    synthesize: (text) => voice.synthesize(text),
  };
}
