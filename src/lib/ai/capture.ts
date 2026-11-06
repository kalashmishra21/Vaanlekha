import { encodeWav } from "./wav";

export type VoiceRecording = { stop: () => Promise<Uint8Array>; cancel: () => Promise<void> };
type AudioContextFactory = new (options?: AudioContextOptions) => AudioContext;
type AudioWindow = { AudioContext?: AudioContextFactory; webkitAudioContext?: AudioContextFactory };

export function microphoneErrorMessage(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone permission was denied. Allow access in your browser settings and try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No microphone was found. Connect a microphone or type your request.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The microphone is busy in another app. Close it and try again.";
  if (name === "AbortError") return "Microphone setup was cancelled. No recording was sent.";
  if (error instanceof Error && error.message) return error.message;
  return "Microphone setup failed. Check browser permission and try again.";
}

function abortableStream(streamRequest: Promise<MediaStream>, signal?: AbortSignal): Promise<MediaStream> {
  if (!signal) return streamRequest;
  if (signal.aborted) {
    void streamRequest.then((stream) => stream.getTracks().forEach((track) => track.stop()), () => undefined);
    return Promise.reject(new DOMException("Microphone setup was cancelled.", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Microphone setup was cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    streamRequest.then((stream) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        reject(new DOMException("Microphone setup was cancelled.", "AbortError"));
      } else resolve(stream);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export async function startVoiceRecording(signal?: AbortSignal): Promise<VoiceRecording> {
  const audioContext = (window as unknown as AudioWindow).AudioContext ?? (window as unknown as AudioWindow).webkitAudioContext;
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    throw new Error("Microphone access requires HTTPS. Open the secure Vaanlekha site and try again.");
  }
  if (!navigator.mediaDevices?.getUserMedia || !audioContext || !window.AudioWorkletNode) {
    throw new Error("This browser cannot capture microphone audio. Update the browser or use its speech recognition fallback.");
  }
  if (signal?.aborted) throw new DOMException("Microphone setup was cancelled.", "AbortError");

  // Create and resume the audio context synchronously from the click handler;
  // mobile Safari may suspend contexts if they are created after permission.
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let closed = false;
  try {
    const audio = new audioContext({ latencyHint: "interactive" });
    context = audio;
    const resumed = audio.resume();
    const streamRequest = navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    [stream] = await Promise.all([abortableStream(streamRequest, signal), resumed.then(() => undefined)]);
    if (signal?.aborted) throw new DOMException("Microphone setup was cancelled.", "AbortError");
    if (audio.state !== "running") await audio.resume();
    await audio.audioWorklet.addModule("/voice-capture-processor.js");
    if (signal?.aborted) throw new DOMException("Microphone setup was cancelled.", "AbortError");

    source = audio.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(audio, "dukaansaathi-voice-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const chunks: Float32Array[] = [];
    processor.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (event.data instanceof Float32Array) chunks.push(event.data);
    };
    source.connect(processor);
    processor.connect(audio.destination);
    const sampleRate = audio.sampleRate;
    async function cleanup() {
      if (closed) return;
      closed = true;
      source?.disconnect();
      processor?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      try { await audio.close(); } catch { /* Context may already have closed after browser suspension. */ }
    }
    return {
      stop: async () => { await cleanup(); return encodeWav(chunks, sampleRate); },
      cancel: cleanup,
    };
  } catch (error) {
    source?.disconnect();
    processor?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && !closed) {
      closed = true;
      try { await context.close(); } catch { /* Context may already have closed. */ }
    }
    if (signal?.aborted) throw new DOMException("Microphone setup was cancelled.", "AbortError");
    throw new Error(microphoneErrorMessage(error));
  }
}
