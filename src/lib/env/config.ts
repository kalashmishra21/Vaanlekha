import { z } from "zod";

const providerConfigSchema = z.object({
  AI_PROVIDER: z.enum(["mock", "gnani"]).default("mock"),
  AI_REASONER: z.enum(["mock", "openrouter", "gemini"]).default("mock"),
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
  return providerConfigSchema.parse(environment);
}
