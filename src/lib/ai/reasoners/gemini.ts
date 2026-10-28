import { todayInIndia } from "../../business/calculations";
import { OpenRouterReasoner } from "./openrouter";

/** Gemini's documented OpenAI-compatible endpoint uses the same validated tool boundary. */
export class GeminiReasoner extends OpenRouterReasoner {
  constructor(key: string, model: "gemini-3.5-flash-lite", request: typeof fetch = fetch,
    today: () => string = todayInIndia, beforeNetworkRequest?: () => Promise<void>) {
    super(key, model, request, today, beforeNetworkRequest, {
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      provider: "Gemini",
      timeoutMs: 12_000,
      retryAttempts: 1,
    });
  }
}
