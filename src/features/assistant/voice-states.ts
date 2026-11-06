export const voiceStates = {
  idle: { label: "Ready", detail: "Type a request or use the microphone." },
  requesting_permission: { label: "Requesting microphone", detail: "Allow microphone access in your browser to continue." },
  recording: { label: "Recording", detail: "Microphone is recording. Stop to process or cancel to discard." },
  processing_audio: { label: "Processing audio", detail: "Preparing the recording. No store action has been sent." },
  transcribing: { label: "Transcribing", detail: "Turning speech into text. No store action has been sent." },
  reasoning: { label: "Understanding", detail: "Checking what you asked for." },
  executing: { label: "Checking store", detail: "A trusted server tool is checking your shop data." },
  completed: { label: "Completed", detail: "The recognized request and verified result are shown in the conversation." },
  speaking: { label: "Speaking response", detail: "Playing the verified response." },
  cancelled: { label: "Cancelled", detail: "The recording was discarded. No store action was sent." },
  unsupported: { label: "Microphone unavailable", detail: "Type your request or open Vaanlekha over HTTPS in a supported browser." },
  error: { label: "Needs attention", detail: "No business action was confirmed. Please try again." },
} as const;

export type VoiceState = keyof typeof voiceStates;

/** A completed capture token can be submitted only once, even if browser events repeat. */
export class VoiceSubmissionGate {
  private readonly completed = new Set<number>();

  claim(sessionId: number): boolean {
    if (!Number.isSafeInteger(sessionId) || sessionId < 1 || this.completed.has(sessionId)) return false;
    this.completed.add(sessionId);
    if (this.completed.size > 64) this.completed.delete(this.completed.values().next().value as number);
    return true;
  }
}
