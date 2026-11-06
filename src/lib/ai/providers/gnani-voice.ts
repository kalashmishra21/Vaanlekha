import { z } from "zod";
import type { AIProvider, ReasoningInput, SpeechResult, TranscriptionInput, TranscriptionResult } from "../types/provider";
import type { ReasoningResult } from "../types/tool-call";
import { MockAIProvider } from "./mock";
import { ProviderRequestError } from "../provider-http";

// Official REST API: https://docs.gnani.ai/api/STT/speech-to-text
const STT_URL = "https://api.vachana.ai/stt/v3";
// Official REST API: https://docs.gnani.ai/api/TTS/tts-inference
const TTS_URL = "https://api.vachana.ai/api/v1/tts/inference";
const transcriptSchema = z.object({ success: z.literal(true), transcript: z.string().trim().min(1) });

export class GnaniVoiceProvider implements AIProvider {
  private readonly mockReasoning = new MockAIProvider();

  constructor(private readonly key: string, private readonly request: typeof fetch = fetch) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!input.audio.length || input.audio.length > 1_000_000) throw new Error("Audio must be a short WAV clip under 1 MB.");
    if (input.mimeType !== "audio/wav") throw new Error("Gnani Prisma requires a WAV recording in this app.");
    const language = z.enum(["hi-IN", "en-IN"]).parse(input.languageHint ?? "hi-IN");
    const form = new FormData();
    form.set("audio_file", new File([new Uint8Array(input.audio)], "request.wav", { type: "audio/wav" }));
    // Prisma v3 supports up to four language hints and the documented
    // code-mixed output mode, which handles Hindi, Hinglish and Indian English.
    form.set("model", "prisma-v3.0");
    form.set("language_code", language === "hi-IN" ? "hi-IN,en-IN" : "en-IN,hi-IN");
    form.set("format", "codemix");
    const response = await this.request(STT_URL, {
      method: "POST", headers: { "X-API-Key-ID": this.key }, body: form,
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) throw new ProviderRequestError("Gnani Prisma", response.status, response.headers.get("retry-after"));
    const parsed = transcriptSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Gnani Prisma returned an invalid transcript.");
    return { text: parsed.data.transcript, language };
  }

  // Evon v3.3 is officially documented for self-hosting, but no hosted inference
  // route is configured here. Structured business intent remains deterministic.
  reason(input: ReasoningInput): Promise<ReasoningResult> {
    return this.mockReasoning.reason(input);
  }

  async synthesize(text: string): Promise<SpeechResult> {
    const spokenText = z.string().trim().min(1).max(500).parse(text);
    const response = await this.request(TTS_URL, {
      method: "POST",
      headers: { "X-API-Key-ID": this.key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spokenText, voice: "Nalini", model: "timbre-v2.5", language: "hi-en", speed: 1,
        audio_config: { sample_rate: 16000, num_channels: 1, sample_width: 2, encoding: "linear_pcm", container: "wav" },
      }),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    if (!response.ok) throw new ProviderRequestError("Gnani Timbre", response.status, response.headers.get("retry-after"));
    if (!response.headers.get("content-type")?.startsWith("audio/")) throw new Error("Gnani Timbre returned non-audio data.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 44 || bytes.length > 5_000_000) throw new Error("Gnani Timbre returned invalid audio.");
    return { kind: "audio", bytes, mimeType: "audio/wav" };
  }
}
