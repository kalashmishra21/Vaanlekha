"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { appearanceEvent, applyAppearance, readAppearance, saveAppearance } from "@/lib/appearance";

export function AppearanceControl({ placement }: { placement: "public" | "workspace" | "auth" }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => {
      applyAppearance(readAppearance());
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    };
    const media = matchMedia("(prefers-color-scheme: dark)");
    const frame = requestAnimationFrame(sync);
    window.addEventListener(appearanceEvent, sync);
    window.addEventListener("storage", sync);
    media.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(appearanceEvent, sync);
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", sync);
    };
  }, []);

  return <div className={`appearance-control appearance-control-${placement}`}>
    <button type="button" className="appearance-trigger" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={() => saveAppearance(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
      <span>{theme === "dark" ? "Light" : "Dark"} mode</span>
    </button>
  </div>;
}
