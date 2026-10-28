"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function CreateShop() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) { setError("Enter your shop name."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "shop.create", name: name.trim() }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Could not create your shop.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create your shop."); }
    finally { setBusy(false); }
  }

  return <form className="business-form create-shop-form" onSubmit={(event) => void create(event)}>
    <label htmlFor="new-shop-name">Shop name</label>
    <input id="new-shop-name" name="name" value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required autoComplete="organization" />
    <button className="button button-copper" type="submit" disabled={busy}>{busy ? "Creating…" : "Create your shop"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
