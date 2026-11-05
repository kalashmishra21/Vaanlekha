"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { translate, type Locale } from "@/lib/i18n";

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void; t: (source: string) => string };
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, updateLocale] = useState(initialLocale);
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    document.documentElement.lang = next === "hi" ? "hi-IN" : "en-IN";
    document.cookie = `vaanlekha-language=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    window.dispatchEvent(new CustomEvent("vaanlekha-language-changed", { detail: next }));
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: (source: string) => translate(locale, source) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
