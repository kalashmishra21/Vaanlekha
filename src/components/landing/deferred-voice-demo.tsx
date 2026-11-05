"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useLocale } from "@/components/layout/locale-provider";

type VoiceDemoComponent = ComponentType;

export function DeferredLandingVoiceDemo() {
  const { t } = useLocale();
  const slot = useRef<HTMLDivElement>(null);
  const [Demo, setDemo] = useState<VoiceDemoComponent | null>(null);

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    let mounted = true;
    if (!("IntersectionObserver" in window)) {
      void import("./voice-demo").then(({ LandingVoiceDemo }) => {
        if (mounted) setDemo(() => LandingVoiceDemo);
      });
      return () => { mounted = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void import("./voice-demo").then(({ LandingVoiceDemo }) => {
        if (mounted) setDemo(() => LandingVoiceDemo);
      });
    }, { rootMargin: "1100px 0px" });
    observer.observe(element);
    return () => { mounted = false; observer.disconnect(); };
  }, []);

  return <div className="voice-demo-lazy-slot" ref={slot}>
    {Demo ? <Demo /> : <div className="demo-console demo-console-loading" role="status">{t("Voice samples load as you reach this section.")}</div>}
  </div>;
}
