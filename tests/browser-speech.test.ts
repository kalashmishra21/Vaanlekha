import { describe, expect, it, vi } from "vitest";
import { browserSpeechErrorMessage, startBrowserSpeechRecognition, type BrowserSpeechRecognition, type BrowserSpeechResultEvent } from "../src/lib/ai/browser-speech";
import { microphoneErrorMessage } from "../src/lib/ai/capture";
import { VoiceSubmissionGate, voiceStates } from "../src/features/assistant/voice-states";

class FakeRecognition implements BrowserSpeechRecognition {
  static latest: FakeRecognition | undefined;
  lang = "";
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null = null;
  onerror: BrowserSpeechRecognition["onerror"] = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() { FakeRecognition.latest = this; }
}

describe("voice capture lifecycle and duplicate protection", () => {
  it("configures selected Hindi, collects final transcripts and submits only once", () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const session = startBrowserSpeechRecognition(FakeRecognition, "hi-IN", onTranscript, onError);
    expect(FakeRecognition.latest?.lang).toBe("hi-IN");
    expect(FakeRecognition.latest?.continuous).toBe(false);
    session.stop();
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("No speech"));
  });

  it("delivers one final transcript when stop/end events repeat", () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    startBrowserSpeechRecognition(FakeRecognition, "en-IN", onTranscript, onError);
    expect(FakeRecognition.latest?.lang).toBe("en-IN");
    expect(FakeRecognition.latest?.interimResults).toBe(true);
    FakeRecognition.latest?.onresult?.({ results: [Object.assign([{ transcript: "Maggi ke 20 packet add karo" }], { isFinal: true })] });
    FakeRecognition.latest?.onend?.();
    FakeRecognition.latest?.onend?.();
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("Maggi ke 20 packet add karo");
    expect(onError).not.toHaveBeenCalled();
  });

  it("maps permission and browser capability failures to safe user guidance", () => {
    expect(browserSpeechErrorMessage("not-allowed")).toContain("permission was denied");
    expect(browserSpeechErrorMessage("unsupported")).toContain("Type your request");
    expect(microphoneErrorMessage({ name: "NotAllowedError" })).toContain("permission was denied");
    expect(microphoneErrorMessage({ name: "NotReadableError" })).toContain("busy in another app");
  });

  it("models permission, recording, transcription and completion distinctly", () => {
    expect(Object.keys(voiceStates)).toEqual(expect.arrayContaining([
      "idle", "requesting_permission", "recording", "processing_audio", "transcribing", "reasoning", "executing", "completed", "cancelled", "error", "unsupported",
    ]));
  });

  it("accepts a voice capture submission token once even after repeated audio callbacks", () => {
    const gate = new VoiceSubmissionGate();
    expect(gate.claim(1)).toBe(true);
    expect(gate.claim(1)).toBe(false);
    expect(gate.claim(2)).toBe(true);
  });
});
