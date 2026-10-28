"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink } from "lucide-react";
import { rupees } from "@/lib/business/calculations";
import { khataReminder } from "@/lib/business/sharing";
import type { Customer, KhataEntry } from "@/lib/business/schemas";
import { useBusinessMutation } from "./use-business-mutation";

export function KhataWorkspace({ customers, entries, balances, shopName }: { customers: Customer[]; entries: KhataEntry[]; balances: Record<string, number>; shopName: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(customers[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [entryType, setEntryType] = useState<"gave" | "received">("gave");
  const selected = customers.find((customer) => customer.id === selectedId) ?? null;
  const reminder = selected ? khataReminder(selected, balances[selected.id] ?? 0, shopName) : null;
  const visible = customers.filter((customer) => `${customer.name} ${customer.phone ?? ""}`.toLocaleLowerCase("en-IN").includes(search.toLocaleLowerCase("en-IN")));
  const { busy, error, notice, run } = useBusinessMutation();

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const result = await run({ kind: "customer.create", name: String(values.get("name") || "").trim(), phone: String(values.get("phone") || "").trim() || undefined }, "Customer added.");
    if (result) { setSelectedId(String(result.id)); setEntryType("gave"); form.reset(); }
  }

  async function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    if (await run({ kind: "khata.add", customerId: selected.id, type: String(values.get("type")) as "gave" | "received", amount: Number(values.get("amount")), note: String(values.get("note") || "") }, "Ledger entry saved.")) form.reset();
  }

  return <div className="business-page khata-page">
    <div className="workspace-page-heading"><p className="workspace-eyebrow">KHATA / CONNECTED</p><h1>Customer <em>ledger.</em></h1><p>Positive outstanding means the customer owes your shop.</p></div>
    <div className="khata-layout">
      <section className="business-section"><div className="section-heading"><span>CUSTOMERS / {customers.length}</span></div>
        <label className="business-search"><span className="sr-only">Search customers</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer or phone" /></label>
        <div className="customer-list">{visible.length ? visible.map((customer) => <button className={selected?.id === customer.id ? "customer-row selected" : "customer-row"} type="button" key={customer.id} onClick={() => { setSelectedId(customer.id); setEntryType("gave"); }} aria-pressed={selected?.id === customer.id}><span><strong>{customer.name}</strong><small>{customer.phone || "No phone saved"}</small></span><span>{rupees(balances[customer.id] ?? 0)}</span></button>) : <p className="business-muted">{search ? "No customer matches this search." : "No customers yet."}</p>}</div>
        <details className="business-form-panel inset-form"><summary>Add a customer <span>+</span></summary><form className="business-form" onSubmit={(event) => void addCustomer(event)}><label>Name<input name="name" required maxLength={120} placeholder="Customer name" /></label><label>Phone (optional)<input name="phone" type="tel" maxLength={20} placeholder="Leave blank for demo" /></label><button className="button button-dark" disabled={busy} type="submit">Add customer</button></form></details>
      </section>
      <section className="business-section"><div className="section-heading"><span>CUSTOMER ACCOUNT</span><span>LEDGER / INR</span></div>
        {selected ? <><div className="ledger-balance"><span>{selected.name.toUpperCase()} / OUTSTANDING</span><strong>{rupees(balances[selected.id] ?? 0)}</strong><p>{(balances[selected.id] ?? 0) < 0 ? "The shop owes this customer." : "The customer owes the shop."}</p>{reminder && <a className="business-share-link ledger-reminder" href={reminder} target="_blank" rel="noopener noreferrer">Open WhatsApp reminder <ExternalLink size={15} aria-hidden="true" /></a>}</div>
          <form key={selected.id} className="business-form ledger-form" onSubmit={(event) => void addEntry(event)}><div className="ledger-actions" role="group" aria-label="Ledger entry type"><button type="button" aria-pressed={entryType === "gave"} onClick={() => setEntryType("gave")}>Add udhaar</button><button type="button" aria-pressed={entryType === "received"} onClick={() => setEntryType("received")}>Receive payment</button></div><input type="hidden" name="type" value={entryType} /><div className="form-grid"><label>Amount ₹<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Note<input name="note" maxLength={300} placeholder="What was this for?" /></label></div><button className="button button-copper" type="submit" disabled={busy}>{entryType === "gave" ? "Add udhaar" : "Record payment"}</button></form>
          <div className="section-heading ledger-history-heading"><span>LEDGER TIMELINE</span></div>{entries.filter((entry) => entry.customer_id === selected.id).length ? <ul className="activity-list ledger-timeline">{entries.filter((entry) => entry.customer_id === selected.id).map((entry) => <li key={entry.id} data-entry={entry.type}><span>{entry.type === "gave" ? "Udhaar given" : "Payment received"}<small>{new Date(entry.created_at).toLocaleDateString("en-IN")}</small></span><span>{entry.note || "No note"}</span><strong>{entry.type === "gave" ? "+" : "−"}{rupees(entry.amount)}</strong></li>)}</ul> : <p className="business-muted">No entries yet.</p>}</> : <p className="business-muted">Choose a customer or add one to start the ledger.</p>}
      </section>
    </div>
    {notice && <p className="form-notice" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
