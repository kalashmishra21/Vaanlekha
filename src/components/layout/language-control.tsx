"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { useLocale } from "./locale-provider";

export function LanguageControl({ compact = false, persistProfile = true }: { compact?: boolean; persistProfile?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function change(value: string) {
    const next = value === "hi" ? "hi" : "en";
    setLocale(next);
    router.refresh();
    if (!persistProfile) return;
    setSaving(true);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: "preferredLanguage", value: next }),
      });
      // A signed-out visitor's language is already saved locally. Signed-in users get
      // durable profile storage; a network failure never blocks the language switch.
      if (response.status === 401) return;
    } catch { /* Local preference remains available if the profile service is offline. */ }
    finally { setSaving(false); }
  }

  return <label className={`language-control${compact ? " language-control-compact" : ""}`}>
    <Languages size={16} aria-hidden="true" />
    {!compact && <span>{t("Language")}</span>}
    <select aria-label={t("Language")} value={locale} onChange={(event) => void change(event.target.value)}>
      <option value="hi">हिंदी</option><option value="en">English</option>
    </select>
    {saving && <span className="language-saving" role="status">{t("Saving…")}</span>}
  </label>;
}
