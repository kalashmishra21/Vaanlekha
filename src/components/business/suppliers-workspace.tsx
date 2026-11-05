"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import Link from "next/link";
import type { Supplier } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";
import { useLocale } from "@/components/layout/locale-provider";

export function SuppliersWorkspace({ suppliers }: { suppliers: Supplier[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { busy, error, notice, run } = useBusinessMutation();
  const visible = suppliers.filter((supplier) => `${supplier.name} ${supplier.contact_name ?? ""}`.toLocaleLowerCase("en-IN").includes(search.toLocaleLowerCase("en-IN")));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const contactName = String(data.get("contactName") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const action = editing
      ? { kind: "supplier.edit" as const, id: editing.id, name, contactName: contactName || null, phone: phone || null }
      : { kind: "supplier.create" as const, name, contactName: contactName || undefined, phone: phone || undefined };
    if (await run(action, t(editing ? "Supplier updated." : "Supplier added."))) { setEditing(null); setFormOpen(false); form.reset(); }
  }

  return <div className="business-page suppliers-page">
    <header className="workspace-page-heading business-title-row"><div><p className="workspace-eyebrow">{t("SUPPLIERS / CONNECTED")}</p><h1>{t("Supply")} <em>{t("network.")}</em></h1><p>{t("Your directory for purchase orders. Demo contacts are synthetic.")}</p></div><button className="button button-dark" type="button" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus size={17} aria-hidden="true" /> {t("Add supplier")}</button></header>
    <div className="supplier-overview"><strong>{suppliers.length}</strong><span>{t("suppliers in your shop")}</span><Link href="/app/orders">{t("Manage purchase orders")} <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    <div className="business-columns">
      <section className="business-section"><div className="section-heading"><span>{t("SUPPLIER DIRECTORY")} / {suppliers.length}</span><span>{t("CONTACT DIRECTORY")}</span></div>
        <label className="business-search"><Search size={17} aria-hidden="true" /><span className="sr-only">{t("Search suppliers")}</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search suppliers")} /></label>
        {visible.length ? <ul className="merchant-list supplier-list">{visible.map((supplier) => <li key={supplier.id}><span className="supplier-avatar" aria-hidden="true">{supplier.name.slice(0, 1).toUpperCase()}</span><div><strong>{supplier.name}</strong><span>{supplier.contact_name || t("Contact not set")}{supplier.phone ? ` · ${supplier.phone}` : ""}</span></div><button className="text-button" type="button" onClick={() => { setEditing(supplier); setFormOpen(true); }}>{t("Edit")}</button></li>)}</ul>
          : <p className="business-muted">{t(search ? "No supplier matches this search." : "No suppliers yet. Add one to create a purchase order.")}</p>}
      </section>
      {formOpen && <section className="business-section business-form-panel supplier-editor"><div className="section-heading"><span>{t(editing ? "EDIT SUPPLIER" : "ADD SUPPLIER")}</span><button type="button" onClick={() => { setEditing(null); setFormOpen(false); }}>{t("Close")}</button></div>
        <form key={editing?.id ?? "new"} className="business-form" onSubmit={(event) => void save(event)}><label>{t("Supplier name")}<input name="name" required maxLength={120} defaultValue={editing?.name} placeholder={t("e.g. North Market Distributors")} /></label><label>{t("Contact name (optional)")}<input name="contactName" maxLength={120} defaultValue={editing?.contact_name ?? ""} /></label><label>{t("Phone (optional)")}<input name="phone" type="tel" minLength={6} maxLength={20} defaultValue={editing?.phone ?? ""} /></label><button className="button button-dark" type="submit" disabled={busy}><Plus size={16} aria-hidden="true" /> {t(editing ? "Save supplier" : "Add supplier")}</button></form>
      </section>}
    </div>
    {notice && <p className="form-notice" role="status">{t(notice)}</p>}{error && <p className="form-error" role="alert">{t(error)}</p>}
  </div>;
}
