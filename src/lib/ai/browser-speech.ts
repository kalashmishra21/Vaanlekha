export type BrowserSpeechErrorCode = "not-allowed" | "service-not-allowed" | "no-speech" | "network" | "aborted" | "unsupported" | "unknown";
export type BrowserSpeechError = { error: BrowserSpeechErrorCode };
export type BrowserSpeechAlternative = { transcript: string };
export type BrowserSpeechResult = ArrayLike<BrowserSpeechAlternative> & { isFinal: boolean };
export type BrowserSpeechResultEvent = { results: ArrayLike<BrowserSpeechResult> };
export type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechResultEvent) => void) | null;
  onerror: ((event: BrowserSpeechError) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type BrowserSpeechFactory = new () => BrowserSpeechRecognition;
export type BrowserSpeechSession = { stop(): void; cancel(): void };

type SpeechWindow = Window & { SpeechRecognition?: BrowserSpeechFactory; webkitSpeechRecognition?: BrowserSpeechFactory };

export function browserSpeechFactory(target: SpeechWindow = window as SpeechWindow): BrowserSpeechFactory | null {
  return target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
}

export function browserSpeechErrorMessage(code: BrowserSpeechErrorCode): string {
  switch (code) {
    case "not-allowed": case "service-not-allowed": return "Microphone permission was denied. Allow it in browser settings and try again.";
    case "no-speech": return "No speech was detected. Move closer to the microphone and try again.";
    case "network": return "Browser speech recognition is unavailable on this network. Try Gnani or type your request.";
    case "aborted": return "Speech recognition was cancelled. No store action was sent.";
    case "unsupported": return "This browser does not support speech recognition. Type your request instead.";
    case "unknown": return "Speech recognition failed. Try again or type your request.";
  }
}

export function startBrowserSpeechRecognition(
  factory: BrowserSpeechFactory,
  language: "hi-IN" | "en-IN",
  onTranscript: (text: string) => void,
  onError: (message: string) => void,
  onStart: () => void = () => undefined,
): BrowserSpeechSession {
  const recognition = new factory();
  recognition.lang = language;
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  let settled = false;
  let finalText = "";
  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    onError(message);
  };

  recognition.onresult = (event) => {
    const finalParts: string[] = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result?.isFinal && result[0]?.transcript.trim()) finalParts.push(result[0].transcript.trim());
    }
    finalText = finalParts.join(" ").slice(0, 500);
  };
  recognition.onerror = (event) => fail(browserSpeechErrorMessage(event.error));
  recognition.onstart = onStart;
  recognition.onend = () => {
    if (settled) return;
    settled = true;
    if (finalText) onTranscript(finalText);
    else onError(browserSpeechErrorMessage("no-speech"));
  };
  try { recognition.start(); }
  catch {
    fail(browserSpeechErrorMessage("unknown"));
    throw new Error(browserSpeechErrorMessage("unknown"));
  }

  return {
    stop: () => { if (!settled) recognition.stop(); },
    cancel: () => {
      if (settled) return;
      settled = true;
      recognition.abort();
    },
  };
}
