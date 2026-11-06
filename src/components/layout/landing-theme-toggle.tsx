"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { appearanceEvent, applyAppearance, readAppearance, saveAppearance } from "@/lib/appearance";
import styles from "./site-header.module.css";
import { useLocale } from "./locale-provider";

export function LandingThemeToggle() {
  const { t } = useLocale();
  useEffect(() => {
    const sync = () => applyAppearance(readAppearance());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(appearanceEvent, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(appearanceEvent, sync);
    };
  }, []);

  return <button type="button" className={styles.toggle} aria-label={t("Toggle between Ivory Atelier and Forest Studio")} onClick={() => saveAppearance(document.documentElement.dataset.theme === "dark" ? "light" : "dark")}>
    <span className={styles.toDark}><Moon size={17} aria-hidden="true" /><span>{t("Forest Studio")}</span></span>
    <span className={styles.toLight}><Sun size={17} aria-hidden="true" /><span>{t("Ivory Atelier")}</span></span>
  </button>;
}
