"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronDown, CircleUserRound, LogOut, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import { indianMobileError, indianMobileInsertionError } from "@/lib/business/indian-mobile";
import { validateShopLogoFile } from "@/lib/business/shop-logo";
import { useLocale } from "./locale-provider";

type Profile = { displayName: string; email: string; preferredLanguage: Locale | null; shop: { id: string; name: string; currency: string; phone: string | null; logoUrl: string | null } | null };
type SaveField = "displayName" | "shopName" | "phone" | "logo" | "email" | "preferredLanguage";

export function ProfileControl() {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const localeRef = useRef(locale);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<SaveField | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [shopName, setShopName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const logoPreviewUrl = useRef<string | null>(null);

  const clearLogoPreview = useCallback(() => {
    if (logoPreviewUrl.current) URL.revokeObjectURL(logoPreviewUrl.current);
    logoPreviewUrl.current = null;
    setLogoPreview(null);
  }, []);

  function selectLogoFile(file: File | null) {
    clearLogoPreview();
    setLogoFile(null);
    if (!file) return;
    const validation = validateShopLogoFile(file);
    if (validation) { setError(t(validation)); return; }
    const previewUrl = URL.createObjectURL(file);
    logoPreviewUrl.current = previewUrl;
    setLogoPreview(previewUrl);
    setLogoFile(file);
    setError("");
    setNotice("");
  }

  const loadProfile = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/profile", { cache: "no-store" });
      if (!response.ok) throw new Error(t("Account details could not load. Please try again."));
      const data = await response.json() as Profile;
      const storedLanguage = data.preferredLanguage;
      data.preferredLanguage = storedLanguage ? normalizeLocale(storedLanguage) : localeRef.current;
      setProfile(data); setDisplayName(data.displayName); setShopName(data.shop?.name || "");
      setPhone(data.shop?.phone || ""); setPhoneError(indianMobileError(data.shop?.phone || ""));
      setNewEmail(data.email); setLogoFile(null); clearLogoPreview();
      if (storedLanguage) setLocale(data.preferredLanguage);
      else void fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "preferredLanguage", value: localeRef.current }) });
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Account details could not load.")); }
    finally { setLoading(false); }
  }, [clearLogoPreview, setLocale, t]);

  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  useEffect(() => () => {
    if (logoPreviewUrl.current) URL.revokeObjectURL(logoPreviewUrl.current);
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = normalizeLocale((event as CustomEvent<string>).detail);
      setProfile((current) => current ? { ...current, preferredLanguage: next } : current);
    };
    window.addEventListener("vaanlekha-language-changed", sync);
    return () => window.removeEventListener("vaanlekha-language-changed", sync);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void loadProfile(); });
    return () => cancelAnimationFrame(frame);
  }, [loadProfile]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof globalThis.KeyboardEvent && event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
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

  async function save(field: "displayName" | "shopName" | "phone") {
    const rawValue = field === "displayName" ? displayName : field === "shopName" ? shopName : phone;
    const value = field === "phone" ? rawValue : rawValue.trim();
    if (field === "phone") {
      const validation = indianMobileError(value);
      setPhoneError(validation);
      if (validation) return;
    } else if (value.length < 2 || value.length > (field === "displayName" ? 80 : 120)) {
      setError(t(field === "displayName" ? "Use 2–80 characters." : "Use 2–120 characters.")); return;
    }
    setSaving(field); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field, value: field === "phone" ? value || null : value }) });
      const result = await response.json() as { ok?: boolean; value?: string | null; error?: string };
      if (!response.ok || !result.ok) throw new Error(t(result.error || "The change could not be saved."));
      setProfile((current) => current ? field === "displayName"
        ? { ...current, displayName: result.value || value }
        : { ...current, shop: current.shop ? field === "phone" ? { ...current.shop, phone: result.value ?? null } : { ...current.shop, name: result.value || value } : null } : current);
      setNotice(t(field === "displayName" ? "Your name was saved." : field === "phone" ? "Shop phone was saved." : "Your shop name was saved."));
      if (field === "phone") setPhoneError(null);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("The change could not be saved.")); }
    finally { setSaving(null); }
  }

  function checkPhoneKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key.length !== 1) return;
    const input = event.currentTarget;
    const validation = indianMobileInsertionError(input.value, input.selectionStart, input.selectionEnd, event.key);
    if (validation) setPhoneError(validation);
  }

  function checkPhonePaste(event: ClipboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const validation = indianMobileInsertionError(input.value, input.selectionStart, input.selectionEnd, event.clipboardData.getData("text"));
    if (validation) { event.preventDefault(); setPhoneError(validation); }
  }

  async function saveLanguage(next: Locale) {
    setLocale(next); setSaving("preferredLanguage"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "preferredLanguage", value: next }) });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || t("Language preference could not be saved."));
      setProfile((current) => current ? { ...current, preferredLanguage: next } : current);
      setNotice(t("Language preference saved."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t("Language preference could not be saved.")); }
    finally { setSaving(null); }
  }

  async function uploadLogo() {
    if (!logoFile) return;
    const validation = validateShopLogoFile(logoFile);
    if (validation) { setError(t(validation)); return; }
    setSaving("logo"); setError(""); setNotice("");
    try {
      const form = new FormData(); form.set("image", logoFile);
      const response = await fetch("/api/profile/logo", { method: "POST", body: form });
      const result = await response.json() as { ok?: boolean; logoUrl?: string | null; error?: string };
      if (!response.ok || !result.ok) throw new Error(t(result.error || "Image could not be saved."));
      setProfile((current) => current?.shop ? { ...current, shop: { ...current.shop, logoUrl: result.logoUrl || null } } : current);
      setLogoFile(null); clearLogoPreview();
      if (logoInput.current) logoInput.current.value = "";
      setNotice(t("Shop image was saved."));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Image could not be saved.")); }
    finally { setSaving(null); }
  }

  async function changeEmail() {
    const email = newEmail.trim().toLowerCase();
    if (!profile || !email || email === profile.email) return;
    const client = createSupabaseBrowserClient();
    if (!client) { setError(t("Email change is unavailable.")); return; }
    setSaving("email"); setError(""); setNotice("");
    try {
      const { error: authError } = await client.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/auth/callback` });
      if (authError) throw authError;
      setNotice(t("Verification links have been requested. Your current email stays active until Supabase completes the secure change."));
    } catch (reason) { setError(reason instanceof Error ? t(reason.message) : t("Email change could not be requested.")); }
    finally { setSaving(null); }
  }

  async function signOut() {
    setSigningOut(true); setError("");
    const client = createSupabaseBrowserClient();
    if (!client) { setError(t("Connection unavailable. Please try again.")); setSigningOut(false); return; }
    const { error: authError } = await client.auth.signOut();
    if (authError) { setError(t("Could not sign out. Please try again.")); setSigningOut(false); return; }
    setOpen(false);
    router.replace("/");
    router.refresh();
  }

  const initial = (profile?.displayName?.trim().charAt(0) || "S").toUpperCase();
  const logoToPreview = logoPreview || profile?.shop?.logoUrl;
  return <div className="profile-control" ref={root}>
    <button ref={trigger} className="profile-trigger" type="button" aria-label={t("Account and appearance")} aria-expanded={open} aria-controls="profile-menu" onClick={() => setOpen((value) => !value)}>
      <span className="profile-avatar" aria-hidden="true">{initial}</span><span className="profile-trigger-label">{t("Account")}</span><ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && <div id="profile-menu" className="profile-menu">
      <div className="profile-menu-identity"><strong>{profile?.displayName || t("Your account")}</strong><span>{profile?.email || (loading ? t("Loading…") : t("Account details unavailable"))}</span></div>
      <button type="button" className="profile-menu-row" onClick={showProfile}><CircleUserRound size={18} aria-hidden="true" /> {t("Profile")}</button>
      <button type="button" className="profile-menu-row profile-signout" disabled={signingOut} onClick={() => void signOut()}><LogOut size={18} aria-hidden="true" />{t(signingOut ? "Signing out…" : "Sign out")}</button>
      {error && <p className="profile-menu-error" role="alert">{t(error)}</p>}
    </div>}
    <dialog ref={dialog} className="profile-dialog" onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="profile-title">
      <div className="profile-dialog-head"><div><span className="profile-dialog-kicker">{t("YOUR ACCOUNT")}</span><h2 id="profile-title">{t("Profile & shop")}</h2></div><button type="button" className="profile-dialog-close" aria-label={t("Close profile")} onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
      {loading && <p role="status">{t("Loading account details…")}</p>}
      {profile && <div className="profile-dialog-content">
        <div className="profile-dialog-section"><h3>{t("Account")}</h3><label htmlFor="profile-language">{t("Language preference")}</label><select id="profile-language" value={profile.preferredLanguage ?? locale} disabled={Boolean(saving)} onChange={(event) => void saveLanguage(normalizeLocale(event.target.value))}><option value="hi">हिंदी</option><option value="en">English</option></select><small>{t("Choose the language for buttons, labels and help across Vaanlekha.")}</small><label htmlFor="profile-name">{t("Full name")}</label><div className="profile-edit-row"><input id="profile-name" value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} /><button type="button" disabled={Boolean(saving) || displayName.trim() === profile.displayName} onClick={() => void save("displayName")}>{t(saving === "displayName" ? "Saving…" : "Save name")}</button></div><label htmlFor="profile-email">{t("Email address")}</label><div className="profile-edit-row"><input id="profile-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} aria-describedby="profile-email-help" /><button type="button" disabled={Boolean(saving) || newEmail.trim().toLowerCase() === profile.email} onClick={() => void changeEmail()}>{t(saving === "email" ? "Sending…" : "Change email")}</button></div><small id="profile-email-help">{t("Current email:")} {profile.email}. {t("Supabase verifies the change before it takes effect.")}</small></div>
        <div className="profile-dialog-section"><h3>{t("Shop")}</h3>{profile.shop ? <><div className="profile-logo-row">{logoToPreview ? <Image src={logoToPreview} alt={t("Shop image")} width={72} height={72} unoptimized /> : <span className="profile-logo-placeholder" aria-hidden="true">{profile.shop.name.charAt(0)}</span>}<div><label htmlFor="profile-logo">{t("Shop image")}</label><input ref={logoInput} id="profile-logo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => selectLogoFile(event.currentTarget.files?.[0] ?? null)} /><small>{t("JPEG, PNG or WebP, up to 2 MB. Private to your shop.")}</small></div><button type="button" disabled={!logoFile || Boolean(saving)} onClick={() => void uploadLogo()}>{t(saving === "logo" ? "Uploading…" : "Upload")}</button></div><label htmlFor="profile-shop-name">{t("Shop name")}</label><div className="profile-edit-row"><input id="profile-shop-name" value={shopName} maxLength={120} onChange={(event) => setShopName(event.target.value)} /><button type="button" disabled={Boolean(saving) || shopName.trim() === profile.shop.name} onClick={() => void save("shopName")}>{t(saving === "shopName" ? "Saving…" : "Save shop")}</button></div><label htmlFor="profile-phone">{t("Shop phone")}</label><div className="profile-edit-row"><input id="profile-phone" type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} maxLength={10} aria-invalid={Boolean(phoneError)} aria-describedby={phoneError ? "profile-phone-error" : undefined} onChange={(event) => { const value = event.currentTarget.value; setPhone(value); setPhoneError(indianMobileError(value)); setError(""); }} onKeyDown={checkPhoneKey} onPaste={checkPhonePaste} /><button type="button" disabled={Boolean(saving) || phone === (profile.shop.phone || "")} onClick={() => void save("phone")}>{t(saving === "phone" ? "Saving…" : "Save phone")}</button></div>{phoneError && <small id="profile-phone-error" className="profile-field-error" role="alert">{t(phoneError)}</small>}<p>{t("Only you can edit this shop.")} {t("Currency:")} {profile.shop.currency}.</p></> : <p>{t("Create your shop from the workspace to get started.")}</p>}</div>
      </div>}
      {notice && <p className="profile-notice" role="status">{t(notice)}</p>}
      {error && <p className="profile-error" role="alert">{t(error)}</p>}
    </dialog>
  </div>;
}
