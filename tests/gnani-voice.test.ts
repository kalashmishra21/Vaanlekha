import { afterEach, describe, expect, it, vi } from "vitest";
import { createAIProvider } from "../src/lib/ai/provider";
import { GnaniVoiceProvider } from "../src/lib/ai/providers/gnani-voice";
import { encodeWav, isShortWav } from "../src/lib/ai/wav";

describe("Gnani voice boundary without network calls", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("keeps mock mode free of Gnani credentials", () => {
    expect(createAIProvider({ AI_PROVIDER: "mock" })).toBeDefined();
    expect(() => createAIProvider({ AI_PROVIDER: "gnani" })).toThrow("GNANI_API_KEY");
    expect(createAIProvider({ AI_PROVIDER: "gnani", GNANI_API_KEY: "test-key" })).toBeInstanceOf(GnaniVoiceProvider);
  });

  it("encodes a bounded mono WAV suitable for Prisma", () => {
    const wav = encodeWav([new Float32Array(16000)], 16000);
    expect(isShortWav(wav)).toBe(true);
    expect(isShortWav(new Uint8Array(44))).toBe(false);
    expect(() => encodeWav([new Float32Array(16 * 16000)], 16000)).toThrow();
  });

  it("uses the documented Prisma and Timbre routes with a server-side key", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const request: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/stt/v3")) return Response.json({ success: true, transcript: "Maggi ke 20 packet add kar do" });
      return new Response(new ArrayBuffer(44), { headers: { "content-type": "audio/wav" } });
    };
    const provider = new GnaniVoiceProvider("test-key", request);
    const transcript = await provider.transcribe({ audio: encodeWav([new Float32Array(8000)], 16000), mimeType: "audio/wav", languageHint: "hi-IN" });
    expect(transcript.text).toBe("Maggi ke 20 packet add kar do");
    expect(calls[0].url).toBe("https://api.vachana.ai/stt/v3");
    expect(new Headers(calls[0].init?.headers).get("X-API-Key-ID")).toBe("test-key");
    expect((calls[0].init?.body as FormData).get("model")).toBe("prisma-v3.0");
    expect((calls[0].init?.body as FormData).get("language_code")).toBe("hi-IN,en-IN");
    expect((calls[0].init?.body as FormData).get("format")).toBe("codemix");
    expect((calls[0].init?.body as FormData).get("audio_file")).toBeInstanceOf(File);

    await provider.transcribe({ audio: encodeWav([new Float32Array(8000)], 16000), mimeType: "audio/wav", languageHint: "en-IN" });
    expect((calls[1].init?.body as FormData).get("language_code")).toBe("en-IN,hi-IN");

    const speech = await provider.synthesize("Stock updated.");
    expect(speech.kind).toBe("audio");
    expect(calls[2].url).toBe("https://api.vachana.ai/api/v1/tts/inference");
    expect(new Headers(calls[2].init?.headers).get("X-API-Key-ID")).toBe("test-key");
    const body = JSON.parse(String(calls[2].init?.body));
    expect(body).toMatchObject({ model: "timbre-v2.5", voice: "Nalini", language: "hi-en" });
  });

  it("rejects invalid model output before it becomes an assistant transcript", async () => {
    const request: typeof fetch = async () => Response.json({ success: true, transcript: "" });
    const provider = new GnaniVoiceProvider("test-key", request);
    await expect(provider.transcribe({ audio: encodeWav([new Float32Array(8000)], 16000), mimeType: "audio/wav" })).rejects.toThrow("invalid transcript");
  });

  it("surfaces a Prisma rate limit without fabricating a transcript", async () => {
    const request: typeof fetch = async () => new Response(null, { status: 429, headers: { "retry-after": "3" } });
    const provider = new GnaniVoiceProvider("test-key", request);
    await expect(provider.transcribe({ audio: encodeWav([new Float32Array(8000)], 16000), mimeType: "audio/wav" }))
      .rejects.toMatchObject({ provider: "Gnani Prisma", status: 429, retryAfter: "3" });
  });

  it("surfaces a Timbre failure without fabricating playable audio", async () => {
    const request: typeof fetch = async () => Response.json({ success: false }, { status: 500 });
    const provider = new GnaniVoiceProvider("test-key", request);
    await expect(provider.synthesize("Namaste"))
      .rejects.toMatchObject({ provider: "Gnani Timbre", status: 500 });
  });
});
