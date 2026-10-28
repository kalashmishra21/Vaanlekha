"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BusinessAction } from "@/lib/business/schemas";

export function useBusinessMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingRequest = useRef<{ signature: string; key: string } | null>(null);

  async function storageKeyFor(signature: string) {
    if (!crypto.subtle) return null;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature)));
    return `vaanlekha-business:${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  async function run(action: BusinessAction, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const signature = JSON.stringify(action);
      const storageKey = await storageKeyFor(signature);
      if (pendingRequest.current?.signature !== signature) {
        let key: string | null = null;
        try { key = storageKey ? sessionStorage.getItem(storageKey) : null; } catch { /* Retry stays in this page. */ }
        pendingRequest.current = { signature, key: key && /^[0-9a-f-]{36}$/i.test(key) ? key : crypto.randomUUID() };
        try { if (storageKey) sessionStorage.setItem(storageKey, pendingRequest.current.key); } catch { /* Retry stays in this page. */ }
      }
      const response = await fetch("/api/business", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.key }, body: signature,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The action failed.");
      pendingRequest.current = null;
      try { if (storageKey) sessionStorage.removeItem(storageKey); } catch { /* The next action still works. */ }
      setNotice(success);
      router.refresh();
      return body as Record<string, unknown>;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action failed.");
      return null;
    } finally { setBusy(false); }
  }
  return { busy, error, notice, run };
}
