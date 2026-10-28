"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { CorePoster } from "./core-poster";

const InteractiveCore = dynamic(() => import("./vaani-core").then((module) => module.VaaniCore), { ssr: false });

export function DeferredVaaniCore() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // The mobile poster paints before hydration; its lightweight automatic
    // sequence starts later. Mobile still never downloads the 3D scene.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const delay = matchMedia("(max-width: 650px)").matches ? 4500 : 1200;
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(timer);
  }, []);
  return ready ? <InteractiveCore /> : <CorePoster />;
}
