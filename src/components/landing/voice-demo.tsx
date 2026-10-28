"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, Check, Pause, Play } from "lucide-react";

const samples = [
  { phrase: "Maggi ke 20 packet add kar do.", intent: "inventory.adjust", detail: "Maggi · +20 packets", note: "Structured preview. Stock is not updated.", audio: "/audio/demo/inventory.wav" },
  { phrase: "Sharma ji ka kitna udhaar hai?", intent: "khata.getBalance", detail: "Customer · Sharma ji", note: "The signed-in assistant reads the connected ledger.", audio: "/audio/demo/khata.wav" },
  { phrase: "Aaj ki total sale batao.", intent: "sales.getDailySummary", detail: "Daily sales summary", note: "The signed-in assistant reads actual sales for today.", audio: "/audio/demo/sales.wav" },
  { phrase: "Low-stock items ki reorder list bana do.", intent: "inventory.getReorderSuggestions", detail: "Reorder suggestions", note: "Read-only preview. The signed-in assistant checks your shop; no order is created.", audio: "/audio/demo/reorder.wav" },
];

export function LandingVoiceDemo() {
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef(0);
  const sample = samples[selected];

  useEffect(() => () => { audio.current?.pause(); }, []);

  async function choose(index: number) {
    const element = audio.current;
    if (!element) return;
    if (playing === index) { element.pause(); setPlaying(null); return; }
    const id = ++request.current;
    element.pause();
    setSelected(index);
    setPlaying(null);
    setLoading(true);
    setError("");
    element.src = samples[index].audio;
    element.load();
    try {
      await element.play();
      if (request.current === id) { setPlaying(index); setLoading(false); }
    } catch {
      if (request.current === id) { setError("Audio could not play. Try again or check your sound settings."); setLoading(false); }
    }
  }

  return (
    <div className="demo-console">
      <div className="demo-console-header"><span><AudioLines size={16} aria-hidden="true" /> VAANI / VOICE PREVIEW</span><span className="demo-console-signal"><span /> MOCK MODE</span></div>
      <div className="demo-console-body">
        <p className="demo-small-label">SELECT A SAMPLE REQUEST</p>
        <div className="demo-requests">{samples.map((item, index) => <button key={item.phrase} type="button" className={selected === index ? "selected" : ""} aria-label={`${playing === index ? "Pause" : "Play"} sample: ${item.phrase}`} aria-pressed={playing === index} onClick={() => void choose(index)}><span>{item.phrase}</span>{playing === index ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}</button>)}</div>
        <audio ref={audio} preload="none" onEnded={() => setPlaying(null)} onError={() => { setPlaying(null); setLoading(false); setError("Audio could not load. Please try again."); }} />
        <p className="demo-audio-status" role="status" aria-live="polite">{error || (loading ? "Loading sample audio…" : playing === null ? "Choose a request to hear it spoken." : "Playing sample audio. Select it again to pause.")}</p>
        <div className="demo-response" aria-live="polite"><span className="demo-response-kicker"><Check size={15} aria-hidden="true" /> STRUCTURED UNDERSTANDING</span><strong>{sample.intent}</strong><span>{sample.detail}</span><p>{sample.note}</p></div>
      </div>
      <div className="demo-console-footer">DETERMINISTIC DEMO · NO DATA CHANGED</div>
    </div>
  );
}
