import { AudioLines, CircleAlert, CircleCheck, CircleDot, LoaderCircle, Mic, ScanText, Volume2, X } from "lucide-react";
import { voiceStates, type VoiceState } from "@/features/assistant/voice-states";
import { useLocale } from "@/components/layout/locale-provider";

const icons = {
  idle: CircleDot, requesting_permission: Mic, recording: Mic, processing_audio: LoaderCircle,
  transcribing: ScanText, reasoning: LoaderCircle, executing: LoaderCircle, completed: CircleCheck,
  speaking: Volume2, cancelled: X, unsupported: CircleAlert, error: CircleAlert,
};

export function VoiceStateIndicator({ state, realVoice = false, realReasoning = false, connected = false, reasonerMode = "mock" }: { state: VoiceState; realVoice?: boolean; realReasoning?: boolean; connected?: boolean; reasonerMode?: "mock" | "gemini" }) {
  const { t } = useLocale();
  const Icon = icons[state];
  const detail = realVoice && state === "idle" ? "Type a request, attach a list or use the microphone."
    : realVoice && state === "requesting_permission" ? "Allow microphone access in the browser prompt. No recording starts before permission."
    : realVoice && state === "recording" ? "Microphone is recording. Stop to process or cancel to discard."
    : realVoice && state === "processing_audio" ? "Preparing the short recording. No store action has been sent."
    : realVoice && state === "transcribing" ? "Speech recognition is turning the recording into text."
    : realVoice && state === "speaking" ? "Gnani Timbre is playing the verified reply."
    : realReasoning && state === "reasoning" ? reasonerMode === "gemini"
      ? "Gemini is primary; OpenRouter may interpret if Gemini is unavailable."
      : "The development reasoning provider is selecting a structured intent."
    : realReasoning && state === "error" ? "No business action was confirmed. Please try again."
    : connected && state === "executing" ? "A trusted server tool is checking store data."
    : voiceStates[state].detail;
  return <div className="voice-state" data-state={state} role="status" aria-live="polite"><span className="voice-state-icon"><Icon size={19} strokeWidth={1.7} aria-hidden="true" /></span><div><strong>{t(voiceStates[state].label)}</strong><span>{t(detail)}</span></div><AudioLines className="voice-state-wave" size={25} strokeWidth={1.3} aria-hidden="true" /></div>;
}
