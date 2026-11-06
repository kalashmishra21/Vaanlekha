import { z } from "zod";

const providerConfigSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "gnani"]).default("mock"),
  AI_REASONER: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_MODEL: z.literal("gemini-3.5-flash-lite").default("gemini-3.5-flash-lite"),
  OPENROUTER_MODEL: z.string().regex(/:free$/).default("nvidia/nemotron-3-ultra-550b-a55b:free"),
  OPENROUTER_VISION_MODEL: z.string().regex(/:free$/).default("dots-studio/dots-3-note-preview:free"),
  OPENROUTER_VISION_FALLBACK_MODELS: z.string().default("google/gemma-4-31b-it:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
    .transform((value) => value.split(",").map((model) => model.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/:free$/)).max(2)),
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export function readProviderConfig(
  environment: Record<string, string | undefined> = process.env,
): ProviderConfig {
  // Retain compatibility with old deployments that still say "openrouter";
  // normalize it to Gemini instead of ever selecting OpenRouter as primary.
  const requestedReasoner = environment.AI_REASONER === "openrouter" ? "gemini" : environment.AI_REASONER;
  const parsed = providerConfigSchema.parse({ ...environment, AI_REASONER: requestedReasoner });
  // A production deployment must never silently fall back to mock reasoning or
  // select OpenRouter as its primary model. Gemini is the production primary;
  // Gnani is the preferred voice provider. Local development can still opt in
  // to mock mode explicitly.
  if (environment.NODE_ENV === "production") {
    return { ...parsed, AI_PROVIDER: "gnani", AI_REASONER: "gemini" };
  }
  return parsed;
}
