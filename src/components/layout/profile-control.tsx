"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleUserRound, LogOut, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Profile = { displayName: string; email: string; shop: { id: string; name: string; currency: string; demo: boolean } | null };

export function ProfileControl() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"displayName" | "shopName" | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [shopName, setShopName] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      if (!response.ok) throw new Error("Account details could not load. Please try again.");
      const data = await response.json() as Profile;
      setProfile(data); setDisplayName(data.displayName); setShopName(data.shop?.name || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Account details could not load."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadProfile(); });
    return () => cancelAnimationFrame(frame);
  }, [loadProfile]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      if (event instanceof MouseEvent && !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  function showProfile() {
    setOpen(false); setNotice(""); setError("");
    dialog.current?.showModal();
    void loadProfile();
  }

  async function save(field: "displayName" | "shopName") {
    const value = (field === "displayName" ? displayName : shopName).trim();
    if (value.length < 2 || value.length > (field === "displayName" ? 80 : 120)) {
      setError(`Use 2–${field === "displayName" ? 80 : 120} characters.`); return;
    }
    setSaving(field); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value }) });
      const result = await response.json() as { ok?: boolean; value?: string; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "The change could not be saved.");
      setProfile((current) => current ? field === "displayName"
        ? { ...current, displayName: result.value || value }
        : { ...current, shop: current.shop ? { ...current.shop, name: result.value || value } : null } : current);
      setNotice(field === "displayName" ? "Your name was saved." : "Your shop name was saved.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The change could not be saved."); }
    finally { setSaving(null); }
  }

  async function signOut() {
    setSigningOut(true); setError("");
    const client = createSupabaseBrowserClient();
    if (!client) { setError("Connection unavailable. Please try again."); setSigningOut(false); return; }
    const { error: authError } = await client.auth.signOut();
    if (authError) { setError("Could not sign out. Please try again."); setSigningOut(false); return; }
    setOpen(false);
    router.replace("/");
    router.refresh();
  }

  const initial = (profile?.displayName?.trim().charAt(0) || "S").toUpperCase();
  return <div className="profile-control" ref={root}>
    <button ref={trigger} className="profile-trigger" type="button" aria-label="Account and appearance" aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen((value) => !value)}>
      <span className="profile-avatar" aria-hidden="true">{initial}</span><span className="profile-trigger-label">Account</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id="profile-menu" className="profile-menu">
      <div className="profile-menu-identity"><strong>{profile?.displayName || "Your account"}</strong><span>{profile?.email || (loading ? "Loading…" : "Account details unavailable")}</span></div>
      <button type="button" className="profile-menu-row" onClick={showProfile}><CircleUserRound size={18} aria-hidden="true" /> Profile</button>
      <button type="button" className="profile-menu-row profile-signout" disabled={signingOut} onClick={() => void signOut()}><LogOut size={18} aria-hidden="true" />{signingOut ? "Signing out…" : "Sign out"}</button>
      {error && <p className="profile-menu-error" role="alert">{error}</p>}
    </div>}
    <dialog ref={dialog} className="profile-dialog" onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="profile-title">
      <div className="profile-dialog-head"><div><span className="profile-dialog-kicker">YOUR ACCOUNT</span><h2 id="profile-title">Profile &amp; shop</h2></div><button type="button" className="profile-dialog-close" aria-label="Close profile" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
      {loading && <p role="status">Loading account details…</p>}
      {profile && <div className="profile-dialog-content">
        <div className="profile-dialog-section"><h3>Account</h3><label htmlFor="profile-name">Full name</label><div className="profile-edit-row"><input id="profile-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /><button type="button" disabled={Boolean(saving) || displayName.trim() === profile.displayName} onClick={() => void save("displayName")}>{saving === "displayName" ? "Saving…" : "Save name"}</button></div><label htmlFor="profile-email">Email address</label><input id="profile-email" value={profile.email} readOnly aria-describedby="profile-email-help" /><small id="profile-email-help">Email changes are managed through your authentication provider.</small></div>
        <div className="profile-dialog-section"><h3>Shop</h3>{profile.shop ? <><label htmlFor="profile-shop-name">Shop name</label><div className="profile-edit-row"><input id="profile-shop-name" value={shopName} maxLength={120} readOnly={profile.shop.demo} onChange={(event) => setShopName(event.target.value)} /><button type="button" disabled={profile.shop.demo || Boolean(saving) || shopName.trim() === profile.shop.name} onClick={() => void save("shopName")}>{saving === "shopName" ? "Saving…" : "Save shop"}</button></div><p>{profile.shop.demo ? "Demo shop name is fixed so reset and reseed stay reliable." : "Only you can edit this shop."} Currency: {profile.shop.currency}.</p></> : <p>Create a demo shop from the workspace to get started.</p>}</div>
      </div>}
      {notice && <p className="profile-notice" role="status">{notice}</p>}
      {error && <p className="profile-error" role="alert">{error}</p>}
    </dialog>
  </div>;
}
