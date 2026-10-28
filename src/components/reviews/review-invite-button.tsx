"use client";

import { useState } from "react";
import { whatsAppDraft } from "@/lib/business/sharing";

export function ReviewInviteButton({ saleId, shopName }: { saleId: string; shopName: string }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function createLink() {
    if (busy) return;
    setBusy(true);
    setError("");
    setLink("");
    try {
      const response = await fetch("/api/reviews/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saleId }) });
      const result: { path?: string; error?: string } = await response.json();
      if (!response.ok || !result.path?.startsWith("/review/")) throw new Error(result.error || "Could not create review link.");
      setLink(`${window.location.origin}${result.path}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create review link."); }
    finally { setBusy(false); }
  }
  const share = link ? whatsAppDraft(`Thank you for visiting ${shopName}. Please share your feedback about your purchase: ${link}`) : null;
  return <div className="receipt-review-invite"><button type="button" onClick={() => void createLink()} disabled={busy}>{busy ? "Creating link…" : link ? "Replace review link" : "Invite customer feedback"}</button>
    {link && <div role="status"><label>Private, single-use link<input readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>{share && <a href={share} target="_blank" rel="noopener noreferrer">Open WhatsApp draft</a>}<small>Generating another link invalidates this one. A WhatsApp draft is not proof of delivery.</small></div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
