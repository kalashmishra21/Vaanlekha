import { afterEach, describe, expect, it, vi } from "vitest";
import { startVoiceRecording } from "../src/lib/ai/capture";

class FakeProcessor {
  port: { onmessage: ((event: MessageEvent<Float32Array>) => void) | null } = { onmessage: null };
  connect = vi.fn();
  disconnect = vi.fn();
  static latest: FakeProcessor | null = null;
  constructor() { FakeProcessor.latest = this; }
}

class FakeAudioContext {
  state = "running";
  sampleRate = 16000;
  destination = {} as AudioDestinationNode;
  audioWorklet = { addModule: vi.fn(async () => undefined) };
  close = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  source = { connect: vi.fn(), disconnect: vi.fn() } as unknown as MediaStreamAudioSourceNode;
  constructor() {}
  createMediaStreamSource = vi.fn(() => this.source);
}

function setup(getUserMedia: (stream: MediaStream) => Promise<MediaStream>) {
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const context = new FakeAudioContext();
  vi.stubGlobal("window", {
    isSecureContext: true,
    location: { hostname: "vaanlekha.vercel.app" },
    AudioContext: FakeAudioContext,
    AudioWorkletNode: FakeProcessor,
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => getUserMedia(stream) } });
  vi.stubGlobal("AudioWorkletNode", FakeProcessor);
  return { context, stream, track };
}

describe("microphone capture lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts only after permission, encodes one WAV and releases the microphone on stop", async () => {
    const { track } = setup(async (stream) => stream);
    const recording = await startVoiceRecording();
    FakeProcessor.latest?.port.onmessage?.({ data: new Float32Array(4000) } as MessageEvent<Float32Array>);
    const wav = await recording.stop();
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeProcessor.latest?.disconnect).toHaveBeenCalled();
  });

  it("surfaces denied permission and never returns a recording", async () => {
    setup(async () => { throw Object.assign(new Error("permission denied"), { name: "NotAllowedError" }); });
    await expect(startVoiceRecording()).rejects.toThrow("permission was denied");
  });

  it("cancels a pending permission request and stops any stream that resolves later", async () => {
    let resolveStream: (() => void) | undefined;
    const { track } = setup((createdStream) => new Promise((resolve) => { resolveStream = () => resolve(createdStream); }));
    const controller = new AbortController();
    const pending = startVoiceRecording(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveStream?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
